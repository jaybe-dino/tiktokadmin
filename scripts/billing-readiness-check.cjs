// Read-only deployment diagnosis. Deliberately exits nonzero to prevent publishing.
const {Client}=require('pg');
(async()=>{
 const {brandBillingConfig}=await import('../lib/danal/config.ts');
 const config=brandBillingConfig();console.log('GK_CONFIG',JSON.stringify(config.ok?{ok:true}:{ok:false,missing:config.missing}));
 const c=new Client({connectionString:process.env.DATABASE_URL||process.env.DATABASE_URL_UNPOOLED,ssl:{rejectUnauthorized:false}});
 await c.connect();await c.query('BEGIN READ ONLY');
 const queries={control:'SELECT enabled,renewals_enabled,operator_test_enabled,operator_test_contract_id,updated_by,updated_at FROM brand_billing_control',contracts:"SELECT r.id,r.title,c.start_date,c.end_date,r.first_billing_date,c.status,s.status subscription_status,s.is_operator_test FROM recurring_contracts r JOIN contracts c ON c.id=r.contract_id LEFT JOIN brand_billing_subscriptions s ON s.recurring_contract_id=r.id WHERE r.created_at>now()-interval '2 days' ORDER BY r.created_at DESC LIMIT 8"};
 for(const [name,q]of Object.entries(queries))console.log('GK_DB_'+name,JSON.stringify((await c.query(q)).rows));
 await c.query('ROLLBACK');await c.end();process.exit(1);
})().catch(e=>{console.log('GK_ERROR',e.code||e.message);process.exit(1)});
