// ตราแปดส่วน — ลายเซ็นของหน้า MBTI
// วงกลม 8 ส่วน: ส่วนที่คุณชนะเต็มด้วยสีตระกูล (เข้มตามความชัด) ส่วนที่แพ้เป็นเส้นประจาง ๆ
// อ่าน "คุณเป็นใคร / เอียงไปทางไหนแค่ไหน" ได้ในแวบเดียว — เขียนจาก data model จริง (ผู้ชนะ/ความชัด)
import { MbtiDim } from '../../lib/mbtiData';

const PAIR_SECOND: Record<MbtiDim, Record<string, string>> = {
  EI: { E: 'I', I: 'E' },
  SN: { S: 'N', N: 'S' },
  TF: { T: 'F', F: 'T' },
  JP: { J: 'P', P: 'J' },
};

interface SealProps {
  letters: string; // โค้ด 4 ตัว เช่น "INTJ"
  dims: { dim: MbtiDim; letter: string; clarity: number }[];
  famRgb: string; // "r g b"
}

export default function Seal({ letters, dims, famRgb }: SealProps) {
  // ส่วนละ 45° เรียงตามมิติ: ฝั่งชนะ (E,S,T,J ตามลำดับมุมบน) แล้วตามด้วยฝั่งแพ้
  const segs = dims.flatMap((d, i) => [
    { letter: d.letter, win: true, clarity: d.clarity, a: i * 90, b: i * 90 + 45 },
    { letter: PAIR_SECOND[d.dim][d.letter], win: false, a: i * 90 + 45, b: i * 90 + 90 },
  ]);
  const polar = (deg: number, r: number) => [
    60 + r * Math.cos(((deg - 90) * Math.PI) / 180),
    60 + r * Math.sin(((deg - 90) * Math.PI) / 180),
  ];
  const wedge = (a: number, b: number) => {
    const [x1, y1] = polar(a, 54);
    const [x2, y2] = polar(b, 54);
    return `M 60 60 L ${x1.toFixed(1)} ${y1.toFixed(1)} A 54 54 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
  };

  return (
    <svg viewBox="0 0 120 120" className="h-44 w-44 shrink-0" role="img" aria-label={`ตราแปดส่วนของ ${letters}`}>
      {segs.map((s, i) => (
        <path key={i} d={wedge(s.a, s.b)}
          fill={s.win ? `rgb(${famRgb} / ${0.25 + (0.55 * s.clarity) / 100})` : 'none'}
          stroke={s.win ? 'none' : 'rgb(148 163 184 / 0.35)'} strokeWidth="1" strokeDasharray={s.win ? undefined : '3 3'} />
      ))}
      {segs.map((s, i) => {
        const [x, y] = polar((s.a + s.b) / 2, 64);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            className={`text-[10px] ${s.win ? 'font-bold' : 'opacity-40'}`}
            fill={s.win ? `rgb(${famRgb})` : 'rgb(148 163 184)'}>
            {s.letter}
          </text>
        );
      })}
      <circle cx="60" cy="60" r="54" fill="none" stroke="rgb(148 163 184 / 0.25)" />
      <text x="60" y="60" textAnchor="middle" dominantBaseline="middle"
        className="mbti-serif text-sm font-bold tracking-widest" fill={`rgb(${famRgb})`}>
        {letters}
      </text>
    </svg>
  );
}
