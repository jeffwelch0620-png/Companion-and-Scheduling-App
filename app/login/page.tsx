import { chatGPTSignInPath } from '../chatgpt-auth';
import EmployeeLogin from './sign-in';
export const dynamic='force-dynamic';
export default function LoginPage(){return <EmployeeLogin ownerSignIn={chatGPTSignInPath('/team')}/>;}
