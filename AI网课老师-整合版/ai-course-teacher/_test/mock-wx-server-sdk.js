// 内存版 wx-server-sdk mock：把云函数真实逻辑跑起来验证（不依赖微信云环境）
'use strict';

// 命令对象（db.command.gte 等）
function cmd(op, value) {
  return { __op: op, __value: value };
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
        return { data: rows.map(r => Object.assign({}, r)) };
      },
      async count() {
        return { total: filterDocs(ensure(name).rows, w).length };
      }
    };
    return q;
  }

  return {
    _store: store,
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
          c.rows.push(Object.assign({ _id: id }, data));
          return { _id: id };
        },
        doc(id) {
          return {
            async get() {
              const r = c.rows.find(x => x._id === id);
              if (!r) throw new Error('document not exists: ' + id);
              return { data: Object.assign({}, r) };
            },
            async update({ data }) {
              const r = c.rows.find(x => x._id === id);
              if (!r) throw new Error('document not exists: ' + id);
              Object.assign(r, data);
              return { stats: { updated: 1 } };
            },
            async set({ data }) {
              let r = c.rows.find(x => x._id === id);
              if (!r) { r = { _id: id }; c.rows.push(r); }
              Object.keys(r).forEach(k => { if (k !== '_id') delete r[k]; });
              Object.assign(r, data);
              return { stats: { created: 1, updated: 1 } };
            }
          };
        }
      };
    },
    async createCollection(name) { ensure(name); return {}; }
  };
}

module.exports = { createDb, toTs };
