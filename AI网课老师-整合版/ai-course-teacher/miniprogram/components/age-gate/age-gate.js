const legal = require('../../utils/legal.js');

/* 未成年人保护闸门（对齐 Web 版 requireAgeDeclaration）。
   首屏一次性询问身份 + 是否未满 14 周岁；学生且未满 14 周岁须填监护人联系方式并勾选同意。
   判定全部走 legal.evaluateAgeGate（纯函数），这里只负责表单与 wx 存储。 */
Component({
  properties: {
    visible: { type: Boolean, value: false }
  },
  data: {
    role: 'student',
    minor: 'no',
    guardianContact: '',
    guardianConsent: false,
    showGuardian: false,
    declaredLine: '',
    msg: '',
    ageHint: legal.AGE_HINT
  },
  lifetimes: {
    attached() {
      this.syncFromSaved();
    }
  },
  methods: {
    syncFromSaved() {
      const saved = legal.readAgeDeclaration();
      if (saved) {
        this.setData({
          role: saved.role || 'student',
          minor: saved.isMinor ? 'yes' : 'no',
          guardianContact: saved.guardianContact || '',
          guardianConsent: false,
          declaredLine: '本设备已登记：' + (saved.role === 'guardian' ? '家长 / 老师' : '学生')
            + (saved.isMinor ? '，未满 14 周岁，监护人 ' + (saved.guardianContact || '未填') : '，已满 14 周岁')
            + '。信息有变化请重新选择。'
        });
      } else {
        this.setData({ declaredLine: '' });
      }
      this.syncGuardianBox();
    },
    syncGuardianBox() {
      this.setData({ showGuardian: this.data.role === 'student' && this.data.minor === 'yes' });
    },
    onRoleChange(e) {
      this.setData({ role: e.detail.value, msg: '' });
      this.syncGuardianBox();
    },
    onMinorChange(e) {
      this.setData({ minor: e.detail.value, msg: '' });
      this.syncGuardianBox();
    },
    onContactInput(e) {
      this.setData({ guardianContact: e.detail.value, msg: '' });
    },
    onConsentChange(e) {
      this.setData({ guardianConsent: (e.detail.value || []).length > 0, msg: '' });
    },
    goChildrenRules() {
      wx.navigateTo({ url: '/pages/legal/legal' });
    },
    onConfirm() {
      const r = legal.evaluateAgeGate({
        role: this.data.role,
        minor: this.data.minor === 'yes',
        contact: this.data.guardianContact,
        consentChecked: this.data.guardianConsent,
        saved: legal.readAgeDeclaration()
      });
      if (!r.ok) {
        this.setData({ msg: r.msg });
        return;
      }
      if (r.declaration) legal.saveAgeDeclaration(r.declaration);
      this.setData({ msg: '' });
      this.triggerEvent('pass', { declaration: r.declaration });
    },
    noop() {}
  }
});
