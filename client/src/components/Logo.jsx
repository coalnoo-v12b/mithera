// 과녁 + 체크: "믿을 수 있는 추첨"
export default function Logo({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill="url(#lg)" />
      <circle
        cx="24"
        cy="24"
        r="15"
        fill="none"
        stroke="#fff"
        strokeOpacity=".5"
        strokeWidth="2"
      />
      <circle
        cx="24"
        cy="24"
        r="8"
        fill="none"
        stroke="#fff"
        strokeOpacity=".8"
        strokeWidth="2"
      />
      <path
        d="M17 24.5l5 5 9-11"
        fill="none"
        stroke="#fff"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
