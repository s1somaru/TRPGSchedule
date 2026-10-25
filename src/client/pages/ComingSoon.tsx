// まだ作っていない画面(卓のページ・卓を作る画面は手順5で作る)
import { Link } from "../router";

export function ComingSoon(props: { title: string }) {
  return (
    <main class="page">
      <h1>{props.title}</h1>
      <p class="lead">この画面は準備中です。</p>
      <Link href="/" class="btn btn-block">
        トップへ戻る
      </Link>
    </main>
  );
}
