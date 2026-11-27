const params = new URLSearchParams(location.search);

if (params.has('demo')) {
  // 3D の卓だけを単独で確かめるデモ。
  void import('./render/dev-demo');
} else {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app) app.textContent = 'ボドゲ試遊卓';
}
