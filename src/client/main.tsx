import { render } from "preact";

// 画面は手順4で作る。いまは仮の表示だけ
function App() {
  return <p>準備中です</p>;
}

const root = document.getElementById("app");
if (root) render(<App />, root);
