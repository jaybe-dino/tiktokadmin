/** Bounded diagnostics only: never expose SQL, provider payloads, tokens or raw errors. */
export function billingStartErrorCode(error:unknown):string {
 const e=error as {code?:unknown;message?:unknown}|null;
 if(typeof e?.code==='string'&&/^[0-9A-Z]{5}$/.test(e.code))return 'DB_'+e.code;
 const known=new Set(['BILLING_NOT_CONFIGURED','BILLING_DISABLED','REGULAR_BILLING_DISABLED','INVALID_CONTRACT_LINK','FIRST_BILLING_DATE_PASSED','BILLING_MODE_MISMATCH','SUBSCRIPTION_ALREADY_REGISTERED_OR_HELD','CARD_WINDOW_UNAVAILABLE','CONSENT_OR_LINK_REQUIRED','OPERATOR_TEST_DISABLED','OPERATOR_CONTRACT_MUST_BE_301_TODAY']);
 return typeof e?.message==='string'&&known.has(e.message)?e.message:'PREPARE_FAILED';
}
