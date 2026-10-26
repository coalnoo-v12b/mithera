const LOCKED = '추첨 결과는 수정하거나 삭제할 수 없어요';

const BLOCKED_QUERY_OPS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteMany',
  'findOneAndDelete',
];

// 한 번 저장된 문서는 수정/삭제할 수 없도록 스키마를 잠근다. (저장은 새 문서일 때만 허용)
const lockSchema = (schema) => {
  schema.pre('save', function () {
    if (!this.isNew) throw new Error(LOCKED);
  });
  for (const op of BLOCKED_QUERY_OPS) {
    schema.pre(op, function () {
      throw new Error(LOCKED);
    });
  }
  schema.pre('deleteOne', { document: true, query: true }, function () {
    throw new Error(LOCKED);
  });
};

module.exports = lockSchema;
