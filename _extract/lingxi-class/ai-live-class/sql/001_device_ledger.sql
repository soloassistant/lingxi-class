-- ============================================================================
-- 设备闸门：一个设备只允许注册一个账号
-- 生成时间：2026-09-24
-- 为什么存在：平台不提供手机号登录/绑定（协议层邮箱与手机互斥、只开通 email provider），
--             拿不到实名级唯一标识，退而用设备维度去重。
-- 关键设计：判定与写入**全部在服务端**——
--   1) fingerprint 列有 UNIQUE 约束（数据库层硬约束，任何客户端都绕不过）
--   2) 检查/写入走 SECURITY DEFINER 函数，表本身收回 INSERT/UPDATE/DELETE 权限
--   3) 函数是唯一写入口
-- 局限（已知并接受）：换设备、清浏览器标识、无痕窗口仍可绕过；挡的是"同机反复注册"。
-- ============================================================================

CREATE TABLE IF NOT EXISTS device_ledger (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,          -- 环境特征哈希，不含个人身份信息
  owner_id    TEXT,                          -- 认领该设备的账号 uid
  ua          TEXT,
  platform    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE device_ledger ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON device_ledger FROM anon, authenticated;  -- 只能通过函数写
GRANT SELECT ON device_ledger TO authenticated;                           -- 只读自己的行
CREATE POLICY dl_select_own ON device_ledger FOR SELECT TO authenticated USING (owner_id = auth.uid());

-- 注册前检查（匿名可调用，只回布尔，不泄露归属）
CREATE OR REPLACE FUNCTION device_taken(fp TEXT) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (SELECT 1 FROM device_ledger WHERE fingerprint = fp)
$fn$;
GRANT EXECUTE ON FUNCTION device_taken(TEXT) TO anon, authenticated;

-- 认领设备：'ok' 首次 | 'mine' 就是我自己的 | 'taken' 已被别的账号占用 | 'noauth' 未登录
-- ★ 访客会话的 auth.uid() 是字符串 'anon'（实测），必须显式排除，否则访客会占掉设备额度
CREATE OR REPLACE FUNCTION device_claim(fp TEXT, ua_in TEXT, platform_in TEXT) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  me  TEXT := auth.uid();
  hit TEXT;
BEGIN
  IF me IS NULL OR me = '' OR me = 'anon' THEN RETURN 'noauth'; END IF;
  SELECT owner_id INTO hit FROM device_ledger WHERE fingerprint = fp;
  IF hit IS NULL THEN
    INSERT INTO device_ledger(fingerprint, owner_id, ua, platform)
    VALUES (fp, me, left(coalesce(ua_in, ''), 200), left(coalesce(platform_in, ''), 80));
    RETURN 'ok';
  END IF;
  IF hit = me THEN RETURN 'mine'; END IF;
  RETURN 'taken';
END
$fn$;
GRANT EXECUTE ON FUNCTION device_claim(TEXT, TEXT, TEXT) TO authenticated;

-- 运维查询：谁占了多少设备（排查多开）
-- SELECT owner_id, count(*) AS devices FROM device_ledger GROUP BY owner_id ORDER BY devices DESC;
