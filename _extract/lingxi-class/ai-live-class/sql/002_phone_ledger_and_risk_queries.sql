-- ============================================================================
-- 手机号共用台账 + 多开风控查询
-- 生成时间：2026-09-24
-- 设计意图：平台没有短信校验通道，手机号只能是"声明"；因此**不做拦截**，
--           只做识别、如实告知、留下可统计的记录。
--           家长用一个号代管多个孩子是正当场景，拦了就是误伤。
-- 隐私：服务端只收到加盐 SHA-256 哈希（lingxi-phone-v1|号码），不接触明文。
-- ============================================================================

CREATE TABLE IF NOT EXISTS phone_ledger (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone_hash TEXT NOT NULL,
  owner_id   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (phone_hash, owner_id)        -- 同一账号重复登记同一号码不产生多行
);

ALTER TABLE phone_ledger ENABLE ROW LEVEL SECURITY;
-- 完全收回直读直写：唯一入口是下面的 SECURITY DEFINER 函数
REVOKE INSERT, UPDATE, DELETE, SELECT ON phone_ledger FROM anon, authenticated;

-- 返回 'ok' 首次 | 'shared' 该号码已在别的账号登记过 | 'noauth' 未登录 | 'invalid' 参数异常
CREATE OR REPLACE FUNCTION phone_claim(h TEXT) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  me     TEXT := auth.uid();
  others INT;
BEGIN
  IF h IS NULL OR length(h) < 32 THEN RETURN 'invalid'; END IF;
  -- 访客会话的 uid 是字符串 'anon'（实测），必须显式排除
  IF me IS NULL OR me = '' OR me = 'anon' THEN RETURN 'noauth'; END IF;
  SELECT count(DISTINCT owner_id) INTO others
    FROM phone_ledger WHERE phone_hash = h AND owner_id <> me;
  INSERT INTO phone_ledger(phone_hash, owner_id) VALUES (h, me)
    ON CONFLICT (phone_hash, owner_id) DO NOTHING;
  IF others > 0 THEN RETURN 'shared'; END IF;
  RETURN 'ok';
END
$fn$;
GRANT EXECUTE ON FUNCTION phone_claim(TEXT) TO authenticated;

-- ============================================================================
-- 运维/风控查询（在云服务数据库控制台执行，只读）
-- ============================================================================

-- ① 多开嫌疑：同一设备绑定了多个账号
SELECT owner_id, count(*) AS accounts_on_device
  FROM device_ledger GROUP BY owner_id HAVING count(*) > 1 ORDER BY 2 DESC;

-- ② 共用号码：同一个手机号（哈希）出现在多个账号上
SELECT phone_hash, count(DISTINCT owner_id) AS accounts
  FROM phone_ledger GROUP BY phone_hash HAVING count(DISTINCT owner_id) > 1 ORDER BY 2 DESC;

-- ③ 注册风控事件汇总（近 7 天）：一次性邮箱被拦、手机号门禁、手机号共用、设备冲突
-- 注意：analytics_events 的真实列是 name / props（不是 event / payload），
--       props 里存 track() 传入的字段。
SELECT
  count(*) FILTER (WHERE name = 'mail_blocked')    AS blocked_disposable_mail,
  count(*) FILTER (WHERE name = 'phone_gate')      AS phone_gate_hits,
  count(*) FILTER (WHERE name = 'phone_shared')    AS shared_phone_users,
  count(*) FILTER (WHERE name = 'device_conflict') AS device_conflicts
FROM analytics_events
WHERE created_at > now() - interval '7 days';

-- ④ 手机号门禁流失：被拦动作分布（props.blocked 存的是动作名）
SELECT props->>'blocked' AS blocked_action, count(*) AS hits
FROM analytics_events
WHERE name = 'phone_gate' AND created_at > now() - interval '7 days'
GROUP BY 1 ORDER BY 2 DESC;

-- ⑤ 被拦的一次性邮箱域名排行（用于按数据维护黑名单）
SELECT props->>'domain' AS domain, count(*) AS hits
FROM analytics_events
WHERE name = 'mail_blocked' AND created_at > now() - interval '30 days'
GROUP BY 1 ORDER BY 2 DESC LIMIT 20;

-- ⑥ 手机号门禁的转化：多少人被拦后最终登记了手机号（同期 phone_register 数）
SELECT
  count(*) FILTER (WHERE name = 'phone_gate')     AS gated,
  count(*) FILTER (WHERE name = 'phone_register') AS registered
FROM analytics_events
WHERE created_at > now() - interval '7 days';
