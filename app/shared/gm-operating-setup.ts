import type {Capability} from './types';

// This is an explicitly selected setup proposal, never a Toast-title mapping.
// The existing access service still requires administrator review and enablement.
export function gmOperatingSetup():{area:string;position:string;capabilities:Capability[]} {
 return {area:'Executive',position:'General manager',capabilities:['tasks.manage','operations.store']};
}

// An optional proposal for administrator review, never an automatic grant.
export function gmClosingSetup():{area:string;position:string;capabilities:Capability[]} {
 const setup=gmOperatingSetup();
 return {...setup,capabilities:[...setup.capabilities,'close.confirm']};
}
