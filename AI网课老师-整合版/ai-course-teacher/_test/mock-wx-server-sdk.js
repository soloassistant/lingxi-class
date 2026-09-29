// 内存版 wx-server-sdk mock：把云函数真实逻辑跑起来验证（不依赖微信云环境）
'use strict';

// 命令对象（db.command.gte 等）
function cmd(op, value) {
  return { __op: op, __value: value };
}

/* ★ 2026-09-29 补：点路径写入。
   真实云数据库的 update 里 `{ 'levels.ielts': {...} }` 是写到**嵌套层级**的；
   桩里若直接 Object.assign，就会留下字面键 "levels.ielts" ——
   测试照样绿，真实行为却完全不同（"假通过"就是这么来的）。 */
function setPath(obj, path, value) {
  const parts = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

function applyPatch(target, data) {
  Object.keys(data || {}).forEach(k => {
    if (k.indexOf('.') >= 0) setPath(target, k, data[k]);
    else target[k] = data[k];
  });
  return target;
}

// get/set 返回副本，避免测试之间通过共享引用互相污染
function deepClone(v) {
  if (v == null || typeof v !== 'object') return v;
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(deepClone);
  const o = {};
  Object.keys(v).forEach(k => { o[k] = deepClone(v[k]); });
  return o;
}

// 日期比较：把 Date / ISO 字符串统一转时间戳
function toTs(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object' && v.__op) return null; // 命令对象交给 matcher
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

function matches(actual, cond) {
  // 支持 db.command.gte() 风格 —— { __op, __value }
  if (cond && typeof cond === 'object' && cond.__op) {
    const a = toTs(actual);
    const c = toTs(cond.__value);
    switch (cond.__op) {
      case 'gte': return Number(actual) >= Number(cond.__value);
      case 'lte': return Number(actual) <= Number(cond.__value);
      case 'gt': return Number(actual) > Number(cond.__value);
      case 'lt': return Number(actual) < Number(cond.__value);
      case 'eq': return a === c || actual === cond.__value;
      default: return false;
    }
  }
  // 支持原生查询操作符风格 —— { $gte: ... }（云数据库同样支持）
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    const opKeys = Object.keys(cond).filter(k => k[0] === '$');
    if (opKeys.length > 0) {
      return opKeys.every(k => {
        switch (k) {
          case '$gte': return Number(actual) >= Number(cond[k]);
          case '$lte': return Number(actual) <= Number(cond[k]);
          case '$gt': return Number(actual) > Number(cond[k]);
          case '$lt': return Number(actual) < Number(cond[k]);
          case '$eq': return actual === cond[k];
          case '$ne': return actual !== cond[k];
          default: return false;
        }
      });
    }
  }
  if (actual === cond) return true;
  const a = toTs(actual), c = toTs(cond);
  if (a != null && c != null) return a === c;
  return String(actual) === String(cond);
}

function filterDocs(rows, where) {
  return rows.filter(r => {
    return Object.keys(where || {}).every(k => matches(r[k], where[k]));
  });
}

function createDb(initial) {
  // 集合：name -> { rows: [{_id, ...}], seq }
  const store = {};
  const ensure = (name) => {
    if (!store[name]) store[name] = { rows: [], seq: 0 };
    return store[name];
  };
  // 预置集合
  Object.keys(initial || {}).forEach(name => {
    const c = ensure(name);
    (initial[name] || []).forEach(r => c.rows.push(Object.assign({ _id: name + '_' + (++c.seq) }, r)));
  });

  function serverDate() { return new Date(); }

  // 查询链：collection().where().orderBy().limit().get() / .count()
  function makeQuery(name, where, order, limit) {
    let w = where || null, o = order || null, lim = limit || Infinity;
    const q = {
      where(c) { w = c; return q; },
      orderBy(field, dir) { o = { field, dir }; return q; },
      limit(n) { lim = n; return q; },
      async get() {
        let rows = filterDocs(ensure(name).rows, w);
        if (o) {
          rows = rows.slice().sort((a, b) => {
            const av = a[o.field], bv = b[o.field];
            const at = toTs(av), bt = toTs(bv);
            if (at != null && bt != null) return o.dir === 'desc' ? bt - at : at - bt;
            const as = String(av), bs = String(bv);
            return o.dir === 'desc' ? (as < bs ? 1 : -1) : (as > bs ? 1 : -1);
          });
        }
        rows = rows.slice(0, lim);
        return { data: rows.map(r => deepClone(r)) };
      },
      async count() {
        return { total: filterDocs(ensure(name).rows, w).length };
      },
      /* ★ 2026-09-29 补：条件更新（`where(...).update({data})`）。
         真实云数据库支持它，且**返回 stats.updated = 实际改到的行数** ——
         reviewDraft 的"原子抢占"就是靠这个计数判断自己有没有抢到。
         桩里必须如实模拟行数（一律返回 1 会让并发测试恒过，等于没测）。 */
      async update({ data }) {
        const hit = filterDocs(ensure(name).rows, w);
        hit.forEach(r => applyPatch(r, data));
        return { stats: { updated: hit.length } };
      }
    };
    return q;
  }

  const db = {
    _store: store,
    /* 两种 SDK 行为都要能测（不同版本/不同路径下不一致）：
       - _updateMissingThrows：对不存在的文档 update 时，是 reject 还是返回 updated:0。
         代码必须两种都活下来，而且**两种情况都不能靠 set 覆盖整篇文档**。
       - _updateExistingUpdated：文档存在时 updated 报几。
         真实环境里"值完全相同"也可能报 0，所以 0 不代表文档不存在。 */
    _updateMissingThrows: true,
    _updateExistingUpdated: 1,
    serverDate,
    command: { gte: (v) => cmd('gte', v), lte: (v) => cmd('lte', v), gt: (v) => cmd('gt', v), lt: (v) => cmd('lt', v), eq: (v) => cmd('eq', v) },
    collection(name) {
      const c = ensure(name);
      return {
        where(w) { return makeQuery(name, w, null, Infinity); },
        orderBy(f, d) { return makeQuery(name, null, { field: f, dir: d }, Infinity); },
        limit(n) { return makeQuery(name, null, null, n); },
        async add({ data }) {
          const id = name + '_' + (++c.seq);
          c.rows.push(Object.assign({ _id: id }, deepClone(data)));
          return { _id: id };
        },
        doc(id) {
          return {
            async get() {
              const r = c.rows.find(x => x._id === id);
              if (!r) throw new Error('document not exists: ' + id);
              return { data: deepClone(r) };
            },
            async update({ data }) {
              const r = c.rows.find(x => x._id === id);
              if (!r) {
                if (db._updateMissingThrows) throw new Error('document not exists: ' + id);
                return { stats: { updated: 0 } };
              }
              applyPatch(r, data);
              return { stats: { updated: db._updateExistingUpdated } };
            },
            // ★ 注意：set 是"整篇替换"，**刻意不展开点路径**。
            //   把 'levels.x' 交给 set 会写出一个字面键，读 doc.levels 得到 undefined。
            //   桩如果在这里也展开，就会掩盖这类真实缺陷 —— 所以保持字面语义。
            async set({ data }) {
              let r = c.rows.find(x => x._id === id);
              if (!r) { r = { _id: id }; c.rows.push(r); }
              Object.keys(r).forEach(k => { if (k !== '_id') delete r[k]; });
              // 顶层键照写；含点的键**保持字面**（如 'a.b' 就存成字面键），如实模拟 set 的替换语义
              Object.keys(data || {}).forEach(k => { r[k] = deepClone(data[k]); });
              return { stats: { created: 1, updated: 1 } };
            }
          };
        }
      };
    },
    async createCollection(name) { ensure(name); return {}; }
  };
  return db;
}

module.exports = { createDb, toTs };
