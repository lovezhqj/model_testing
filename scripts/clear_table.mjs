import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Parse .env.local manually
const envPath = resolve(process.cwd(), '.env.local');
const envContent = readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx > 0) {
    env[trimmed.substring(0, eqIdx)] = trimmed.substring(eqIdx + 1);
  }
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

console.log('正在清空 model_testing 表...');

const { error, count } = await supabase
  .from('model_testing')
  .delete({ count: 'exact' })
  .gte('id', 0);

if (error) {
  console.error('删除失败:', error.message);
  process.exit(1);
}

console.log(`✅ 成功清空 model_testing 表，共删除 ${count ?? '未知数量'} 条记录`);
