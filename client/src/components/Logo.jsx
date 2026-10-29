// 미더라 엠블럼 이미지 (client/public/midura-logo.png)
export default function Logo({ size = 36 }) {
  return (
    <img
      src="/midura-logo.png"
      alt=""
      height={size}
      aria-hidden="true"
      style={{ width: 'auto', height: size }}
    />
  );
}
