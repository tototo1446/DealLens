-- 抽出値が null (未発話など) でも保存できるようにする
alter table extraction_results
  alter column value drop not null;
