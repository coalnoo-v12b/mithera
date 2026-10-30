// 미더라 엠블럼 이미지 (client/public/crest/full.webp)
// 원본 midura-logo.png 의 테두리를 scripts/cut-crest.py 로 정리한 것
export default function Logo({ size = 36 }) {
  return (
    <img
      src="/crest/full.webp"
      alt=""
      height={size}
      aria-hidden="true"
      style={{ width: 'auto', height: size }}
    />
  );
}
