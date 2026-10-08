import { AppError } from './validation';

export type CompanionFailureCategory = 'timeout' | 'connection' | 'authentication' | 'permission' | 'model-access' | 'quota' | 'rate-limit' | 'usage-limit' | 'context-limit' | 'service' | 'provider-request' | 'invalid-response' | 'incomplete' | 'refusal' | 'invalid-answer' | 'invalid-sources';

// Only fixed categories and numeric status are safe for diagnostic logs. Never
// carry provider bodies, prompt text, credentials or raw exceptions in this type.
export class CompanionFailure extends AppError {
  constructor(public category:CompanionFailureCategory, message:string, public providerStatus?:number) {
    super(category==='context-limit'?400:['rate-limit','usage-limit'].includes(category)?429:category==='invalid-response'||category==='invalid-answer'||category==='invalid-sources'||category==='incomplete'||category==='refusal'?502:503,message);
  }
}

export function providerFailure(status:number,code:unknown):CompanionFailure {
  const quota=typeof code==='string'&&['insufficient_quota','billing_hard_limit_reached','credit_balance_exhausted','organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded'].includes(code);
  const rate=code==='rate_limit_exceeded'||code==='slow_down';
  const category:CompanionFailureCategory=status===401?'authentication':status===403?'permission':code==='model_not_found'?'model-access':status===429?(quota?'quota':rate?'rate-limit':'usage-limit'):status>=500?'service':'provider-request';
  const message=category==='rate-limit'?'JMAX is temporarily busy. Wait a moment, then try your saved question again.':category==='usage-limit'?'JMAX’s AI service is limiting requests. Try your saved question again later.':['quota','authentication','permission','model-access'].includes(category)?'JMAX’s AI connection needs an administrator’s attention. Your question is saved.':'JMAX’s AI service could not answer this request. Your question is saved so you can try again.';
  return new CompanionFailure(category,message,status);
}
