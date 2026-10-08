import { chatGPTSignInPath } from '../chatgpt-auth';
import OwnerSetup from './setup';
export const dynamic='force-dynamic';
export default function SetupPage(){return <OwnerSetup signInPath={chatGPTSignInPath('/setup')}/>}
