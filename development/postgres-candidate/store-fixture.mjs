// Explicit fictional provisioning values, never defaults for a real store.
export const fictionalDishAliases=['dish','dishwasher','dish washer'].flatMap(base=>
 ['',' am',' pm',' (am)',' (pm)',' (morning)',' (evening)',' (night)',
 'am','pm','(am)','(pm)','(morning)','(evening)','(night)'].map(suffix=>base+suffix));
export const fictionalStoreInsert=`INSERT INTO candidate_identity.restaurants
 (id,name,timezone,operating_departments,dish_department,dish_position,dish_aliases)
 VALUES($1,$2,'America/New_York',ARRAY['FOH','BOH'],'BOH','Dishwasher',
 ARRAY[${fictionalDishAliases.map(label=>"'"+label+"'").join(',')}])`;
