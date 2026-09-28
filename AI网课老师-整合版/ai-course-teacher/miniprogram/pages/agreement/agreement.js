const AGREEMENT_TEXT = `
<h2>用户协议</h2>
<p>欢迎使用本小程序。在使用本服务前，请仔细阅读以下条款。</p>
<h3>一、服务内容</h3><p>本小程序提供国际课程在线学习、测评、复习等服务。</p>
<h3>二、用户行为</h3><p>用户应遵守法律法规，不得利用本服务从事任何违法违规活动。</p>
<h3>三、账号与数据</h3><p>您可以随时申请注销账号，注销后我们会删除您的个人信息。</p>
<h3>四、AI 内容</h3><p>AI 生成内容仅供参考，不构成考试承诺。</p>
`;

const PRIVACY_TEXT = `
<h2>隐私政策</h2>
<p>我们非常重视您的个人信息保护。</p>
<h3>一、信息收集</h3><p>我们仅收集为您提供服务所必需的信息，包括学习进度、错题记录等。</p>
<h3>二、信息使用</h3><p>您的学习数据仅用于个性化推荐与学习报告生成，不向第三方共享。</p>
<h3>三、未成年人保护</h3><p>若您为未成年人，请在监护人指导下使用本服务。</p>
<h3>四、注销与导出</h3><p>您可随时在“我的”页面导出或删除全部数据。</p>
`;

Page({
  data: { content: '' },
  onLoad(options) {
    const type = options.type || 'agreement';
    wx.setNavigationBarTitle({ title: type === 'privacy' ? '隐私政策' : '用户协议' });
    this.setData({ content: type === 'privacy' ? PRIVACY_TEXT : AGREEMENT_TEXT });
  }
});
