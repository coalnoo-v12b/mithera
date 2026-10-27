// 번호(no)가 없는 옛 추첨에 "yyyymmdd-N" 번호를 붙인다. 만든 시각이 빠른 순서대로, 날짜마다 1번부터.
//
// 번호가 없는 추첨이 하나라도 있는 날은 그날의 추첨 전체를 만든 시각 순으로 다시 매긴다.
// (번호 규칙이 먼저 적용된 뒤에 옛 추첨을 채우면, 새 추첨이 1번을 가져가서 순서가 거꾸로 되기 때문)
// 모든 추첨에 번호가 있는 날은 건드리지 않아서 여러 번 실행해도 안전하다.
//
//   npm run backfill:draw-no -w server -- --dry-run   # 바뀔 번호만 미리 보기 (DB 는 바꾸지 않음)
//   npm run backfill:draw-no -w server                # 실제로 적용
const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  quiet: true,
});
const mongoose = require('mongoose');
const { Draw, Counter } = require('../src/models');
const { kstYmd, formatNo } = require('../src/utils/drawNo');

const dryRun = process.argv.includes('--dry-run');
const missing = (d) => d.no == null;

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set');
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 8000,
  });
  await Draw.init(); // 번호 unique 인덱스가 준비된 뒤에 시작

  const all = await Draw.find()
    .sort({ createdAt: 1, _id: 1 })
    .select('title no createdAt');
  const days = new Map(); // yyyymmdd -> 그날의 추첨들 (만든 순서)
  for (const d of all) {
    const ymd = kstYmd(d.createdAt);
    if (!days.has(ymd)) days.set(ymd, []);
    days.get(ymd).push(d);
  }

  const targets = [...days].filter(([, ds]) => ds.some(missing));
  console.log(
    `${dryRun ? '[미리보기] ' : ''}번호를 다시 매길 날짜: ${targets.length}일`
  );

  for (const [ymd, ds] of targets) {
    const plan = ds.map((d, i) => ({ d, no: formatNo(ymd, i + 1) }));
    for (const { d, no } of plan) {
      const note = d.no === no ? '유지' : d.no ? `변경 (이전 ${d.no})` : '신규';
      console.log(`  ${no}  ${d.title}  [${note}]`);
    }
    if (dryRun) continue;

    // 번호가 서로 바뀌어도 unique 인덱스와 충돌하지 않게, 먼저 비우고 다시 채운다
    await Draw.updateMany(
      { _id: { $in: ds.map((d) => d._id) } },
      { $unset: { no: '' } }
    );
    for (const { d, no } of plan) {
      await Draw.updateOne({ _id: d._id }, { $set: { no } });
    }
    // 이 뒤에 만들어지는 추첨은 마지막 번호 다음부터 (이미 더 큰 값이면 그대로 둔다)
    await Counter.findOneAndUpdate(
      { _id: `draw:${ymd}` },
      { $max: { seq: plan.length } },
      { upsert: true }
    );
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('실패:', e.message);
  process.exit(1);
});
