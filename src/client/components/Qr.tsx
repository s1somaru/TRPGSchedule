// QRコード。ライブラリが作る HTML は使わず、白黒の配置だけを受け取って図にする(spec.md 7.2)
import qrcode from "qrcode-generator";
import { useMemo } from "preact/hooks";

export function Qr(props: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(props.value);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (qr.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    return { size: n, path: d };
  }, [props.value]);

  const margin = 3;
  return (
    <svg
      class="qr"
      role="img"
      aria-label={props.label}
      viewBox={`${-margin} ${-margin} ${size + margin * 2} ${size + margin * 2}`}
      shape-rendering="crispEdges"
    >
      <rect x={-margin} y={-margin} width={size + margin * 2} height={size + margin * 2} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
