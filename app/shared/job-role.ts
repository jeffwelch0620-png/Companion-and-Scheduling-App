// Recognize dish-only labels without treating mixed jobs such as Dish / Prep
// as dish-only. Job labels do not confer any management authority or clearance.
export function canonicalJobRole(value:string):string {
  return /^(?:dish|dish\s*washer)(?:\s*(?:\((?:am|pm|morning|evening|night)\)|am|pm))?$/i.test(value.trim())?'Dishwasher':value;
}
