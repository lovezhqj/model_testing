import { readFileSync } from 'fs';
import { resolve } from 'path';

// Parse .env.local
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

const supabaseUrl = env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

const createTableSQL = `
CREATE TABLE IF NOT EXISTS auth_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO auth_config (key, value) VALUES 
('cookies', ''),
('user_id', ''),
('token', '')
ON CONFLICT (key) DO NOTHING;
`;

console.log('正在创建 auth_config 表...');
console.log('Supabase URL:', supabaseUrl);

// Try multiple Supabase internal API endpoints for SQL execution
const endpoints = [
  '/pg-meta/default/query',
  '/pg/query',
  '/rest/v1/rpc/exec_sql',
];

let success = false;

for (const endpoint of endpoints) {
  const url = `${supabaseUrl}${endpoint}`;
  console.log(`\n尝试端点: ${url}`);
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'x-supabase-db-ref': supabaseUrl.split('//')[1]?.split('.')[0] || '',
      },
      body: JSON.stringify({ query: createTableSQL }),
    });
    
    const text = await res.text();
    console.log(`状态码: ${res.status}`);
    console.log(`响应: ${text.substring(0, 300)}`);
    
    if (res.ok) {
      console.log('\n✅ auth_config 表创建成功！');
      success = true;
      break;
    }
  } catch (err) {
    console.log(`请求失败: ${err.message}`);
  }
}

if (!success) {
  console.log('\n❌ 无法通过 API 自动创建表。');
  console.log('\n请手动在 Supabase SQL Editor 中执行以下 SQL：');
  console.log('='.repeat(60));
  console.log(createTableSQL);
  console.log('='.repeat(60));
  console.log('\n步骤：');
  console.log('1. 打开 https://supabase.com/dashboard');
  console.log('2. 选择您的项目');
  console.log('3. 左侧菜单点击 "SQL Editor"');
  console.log('4. 粘贴上面的 SQL 并点击 "Run"');
}
