-- Corrective candidate safeguards; published migrations 001-041 are unchanged.
BEGIN;
CREATE FUNCTION candidate_operations.configuration_label_valid(p_value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $body$
 SELECT coalesce(length(p_value) BETWEEN 1 AND 100 AND p_value=btrim(p_value)
  AND NOT EXISTS(SELECT 1 FROM generate_series(1,length(p_value)) i
   WHERE ascii(substr(p_value,i,1))=ANY(ARRAY[9,10,11,12,13,133,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279])),false);
$body$;
CREATE FUNCTION candidate_operations.configuration_timezone_valid(p_zone text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $body$
 SELECT coalesce(p_zone=ANY(ARRAY['Africa/Abidjan','Africa/Accra','Africa/Addis_Ababa','Africa/Algiers','Africa/Asmara','Africa/Asmera','Africa/Bamako','Africa/Bangui','Africa/Banjul','Africa/Bissau','Africa/Blantyre','Africa/Brazzaville','Africa/Bujumbura','Africa/Cairo','Africa/Casablanca','Africa/Ceuta','Africa/Conakry','Africa/Dakar','Africa/Dar_es_Salaam','Africa/Djibouti','Africa/Douala','Africa/El_Aaiun','Africa/Freetown','Africa/Gaborone','Africa/Harare','Africa/Johannesburg','Africa/Juba','Africa/Kampala','Africa/Khartoum','Africa/Kigali','Africa/Kinshasa','Africa/Lagos','Africa/Libreville','Africa/Lome','Africa/Luanda','Africa/Lubumbashi','Africa/Lusaka','Africa/Malabo','Africa/Maputo','Africa/Maseru','Africa/Mbabane','Africa/Mogadishu','Africa/Monrovia','Africa/Nairobi','Africa/Ndjamena','Africa/Niamey','Africa/Nouakchott','Africa/Ouagadougou','Africa/Porto-Novo','Africa/Sao_Tome','Africa/Timbuktu','Africa/Tripoli','Africa/Tunis','Africa/Windhoek','America/Adak','America/Anchorage','America/Anguilla','America/Antigua','America/Araguaina','America/Argentina/Buenos_Aires','America/Argentina/Catamarca','America/Argentina/ComodRivadavia','America/Argentina/Cordoba','America/Argentina/Jujuy','America/Argentina/La_Rioja','America/Argentina/Mendoza','America/Argentina/Rio_Gallegos','America/Argentina/Salta','America/Argentina/San_Juan','America/Argentina/San_Luis','America/Argentina/Tucuman','America/Argentina/Ushuaia','America/Aruba','America/Asuncion','America/Atikokan','America/Atka','America/Bahia','America/Bahia_Banderas','America/Barbados','America/Belem','America/Belize','America/Blanc-Sablon','America/Boa_Vista','America/Bogota','America/Boise','America/Buenos_Aires','America/Cambridge_Bay','America/Campo_Grande','America/Cancun','America/Caracas','America/Catamarca','America/Cayenne','America/Cayman','America/Chicago','America/Chihuahua','America/Ciudad_Juarez','America/Coral_Harbour','America/Cordoba','America/Costa_Rica','America/Coyhaique','America/Creston','America/Cuiaba','America/Curacao','America/Danmarkshavn','America/Dawson','America/Dawson_Creek','America/Denver','America/Detroit','America/Dominica','America/Edmonton','America/Eirunepe','America/El_Salvador','America/Ensenada','America/Fort_Nelson','America/Fort_Wayne','America/Fortaleza','America/Glace_Bay','America/Godthab','America/Goose_Bay','America/Grand_Turk','America/Grenada','America/Guadeloupe','America/Guatemala','America/Guayaquil','America/Guyana','America/Halifax','America/Havana','America/Hermosillo','America/Indiana/Indianapolis','America/Indiana/Knox','America/Indiana/Marengo','America/Indiana/Petersburg','America/Indiana/Tell_City','America/Indiana/Vevay','America/Indiana/Vincennes','America/Indiana/Winamac','America/Indianapolis','America/Inuvik','America/Iqaluit','America/Jamaica','America/Jujuy','America/Juneau','America/Kentucky/Louisville','America/Kentucky/Monticello','America/Knox_IN','America/Kralendijk','America/La_Paz','America/Lima','America/Los_Angeles','America/Louisville','America/Lower_Princes','America/Maceio','America/Managua','America/Manaus','America/Marigot','America/Martinique','America/Matamoros','America/Mazatlan','America/Mendoza','America/Menominee','America/Merida','America/Metlakatla','America/Mexico_City','America/Miquelon','America/Moncton','America/Monterrey','America/Montevideo','America/Montreal','America/Montserrat','America/Nassau','America/New_York','America/Nipigon','America/Nome','America/Noronha','America/North_Dakota/Beulah','America/North_Dakota/Center','America/North_Dakota/New_Salem','America/Nuuk','America/Ojinaga','America/Panama','America/Pangnirtung','America/Paramaribo','America/Phoenix','America/Port-au-Prince','America/Port_of_Spain','America/Porto_Acre','America/Porto_Velho','America/Puerto_Rico','America/Punta_Arenas','America/Rainy_River','America/Rankin_Inlet','America/Recife','America/Regina','America/Resolute','America/Rio_Branco','America/Rosario','America/Santa_Isabel','America/Santarem','America/Santiago','America/Santo_Domingo','America/Sao_Paulo','America/Scoresbysund','America/Shiprock','America/Sitka','America/St_Barthelemy','America/St_Johns','America/St_Kitts','America/St_Lucia','America/St_Thomas','America/St_Vincent','America/Swift_Current','America/Tegucigalpa','America/Thule','America/Thunder_Bay','America/Tijuana','America/Toronto','America/Tortola','America/Vancouver','America/Virgin','America/Whitehorse','America/Winnipeg','America/Yakutat','America/Yellowknife','Antarctica/Casey','Antarctica/Davis','Antarctica/DumontDUrville','Antarctica/Macquarie','Antarctica/Mawson','Antarctica/McMurdo','Antarctica/Palmer','Antarctica/Rothera','Antarctica/South_Pole','Antarctica/Syowa','Antarctica/Troll','Antarctica/Vostok','Arctic/Longyearbyen','Asia/Aden','Asia/Almaty','Asia/Amman','Asia/Anadyr','Asia/Aqtau','Asia/Aqtobe','Asia/Ashgabat','Asia/Ashkhabad','Asia/Atyrau','Asia/Baghdad','Asia/Bahrain','Asia/Baku','Asia/Bangkok','Asia/Barnaul','Asia/Beirut','Asia/Bishkek','Asia/Brunei','Asia/Calcutta','Asia/Chita','Asia/Choibalsan','Asia/Chongqing','Asia/Chungking','Asia/Colombo','Asia/Dacca','Asia/Damascus','Asia/Dhaka','Asia/Dili','Asia/Dubai','Asia/Dushanbe','Asia/Famagusta','Asia/Gaza','Asia/Harbin','Asia/Hebron','Asia/Ho_Chi_Minh','Asia/Hong_Kong','Asia/Hovd','Asia/Irkutsk','Asia/Istanbul','Asia/Jakarta','Asia/Jayapura','Asia/Jerusalem','Asia/Kabul','Asia/Kamchatka','Asia/Karachi','Asia/Kashgar','Asia/Kathmandu','Asia/Katmandu','Asia/Khandyga','Asia/Kolkata','Asia/Krasnoyarsk','Asia/Kuala_Lumpur','Asia/Kuching','Asia/Kuwait','Asia/Macao','Asia/Macau','Asia/Magadan','Asia/Makassar','Asia/Manila','Asia/Muscat','Asia/Nicosia','Asia/Novokuznetsk','Asia/Novosibirsk','Asia/Omsk','Asia/Oral','Asia/Phnom_Penh','Asia/Pontianak','Asia/Pyongyang','Asia/Qatar','Asia/Qostanay','Asia/Qyzylorda','Asia/Rangoon','Asia/Riyadh','Asia/Saigon','Asia/Sakhalin','Asia/Samarkand','Asia/Seoul','Asia/Shanghai','Asia/Singapore','Asia/Srednekolymsk','Asia/Taipei','Asia/Tashkent','Asia/Tbilisi','Asia/Tehran','Asia/Tel_Aviv','Asia/Thimbu','Asia/Thimphu','Asia/Tokyo','Asia/Tomsk','Asia/Ujung_Pandang','Asia/Ulaanbaatar','Asia/Ulan_Bator','Asia/Urumqi','Asia/Ust-Nera','Asia/Vientiane','Asia/Vladivostok','Asia/Yakutsk','Asia/Yangon','Asia/Yekaterinburg','Asia/Yerevan','Atlantic/Azores','Atlantic/Bermuda','Atlantic/Canary','Atlantic/Cape_Verde','Atlantic/Faeroe','Atlantic/Faroe','Atlantic/Jan_Mayen','Atlantic/Madeira','Atlantic/Reykjavik','Atlantic/South_Georgia','Atlantic/St_Helena','Atlantic/Stanley','Australia/ACT','Australia/Adelaide','Australia/Brisbane','Australia/Broken_Hill','Australia/Canberra','Australia/Currie','Australia/Darwin','Australia/Eucla','Australia/Hobart','Australia/LHI','Australia/Lindeman','Australia/Lord_Howe','Australia/Melbourne','Australia/NSW','Australia/North','Australia/Perth','Australia/Queensland','Australia/South','Australia/Sydney','Australia/Tasmania','Australia/Victoria','Australia/West','Australia/Yancowinna','Brazil/Acre','Brazil/DeNoronha','Brazil/East','Brazil/West','CET','CST6CDT','Canada/Atlantic','Canada/Central','Canada/Eastern','Canada/Mountain','Canada/Newfoundland','Canada/Pacific','Canada/Saskatchewan','Canada/Yukon','Chile/Continental','Chile/EasterIsland','Cuba','EET','EST','EST5EDT','Egypt','Eire','Etc/GMT','Etc/GMT+0','Etc/GMT+1','Etc/GMT+10','Etc/GMT+11','Etc/GMT+12','Etc/GMT+2','Etc/GMT+3','Etc/GMT+4','Etc/GMT+5','Etc/GMT+6','Etc/GMT+7','Etc/GMT+8','Etc/GMT+9','Etc/GMT-0','Etc/GMT-1','Etc/GMT-10','Etc/GMT-11','Etc/GMT-12','Etc/GMT-13','Etc/GMT-14','Etc/GMT-2','Etc/GMT-3','Etc/GMT-4','Etc/GMT-5','Etc/GMT-6','Etc/GMT-7','Etc/GMT-8','Etc/GMT-9','Etc/GMT0','Etc/Greenwich','Etc/UCT','Etc/UTC','Etc/Universal','Etc/Zulu','Europe/Amsterdam','Europe/Andorra','Europe/Astrakhan','Europe/Athens','Europe/Belfast','Europe/Belgrade','Europe/Berlin','Europe/Bratislava','Europe/Brussels','Europe/Bucharest','Europe/Budapest','Europe/Busingen','Europe/Chisinau','Europe/Copenhagen','Europe/Dublin','Europe/Gibraltar','Europe/Guernsey','Europe/Helsinki','Europe/Isle_of_Man','Europe/Istanbul','Europe/Jersey','Europe/Kaliningrad','Europe/Kiev','Europe/Kirov','Europe/Kyiv','Europe/Lisbon','Europe/Ljubljana','Europe/London','Europe/Luxembourg','Europe/Madrid','Europe/Malta','Europe/Mariehamn','Europe/Minsk','Europe/Monaco','Europe/Moscow','Europe/Nicosia','Europe/Oslo','Europe/Paris','Europe/Podgorica','Europe/Prague','Europe/Riga','Europe/Rome','Europe/Samara','Europe/San_Marino','Europe/Sarajevo','Europe/Saratov','Europe/Simferopol','Europe/Skopje','Europe/Sofia','Europe/Stockholm','Europe/Tallinn','Europe/Tirane','Europe/Tiraspol','Europe/Ulyanovsk','Europe/Uzhgorod','Europe/Vaduz','Europe/Vatican','Europe/Vienna','Europe/Vilnius','Europe/Volgograd','Europe/Warsaw','Europe/Zagreb','Europe/Zaporozhye','Europe/Zurich','GB','GB-Eire','GMT','GMT+0','GMT-0','GMT0','Greenwich','HST','Hongkong','Iceland','Indian/Antananarivo','Indian/Chagos','Indian/Christmas','Indian/Cocos','Indian/Comoro','Indian/Kerguelen','Indian/Mahe','Indian/Maldives','Indian/Mauritius','Indian/Mayotte','Indian/Reunion','Iran','Israel','Jamaica','Japan','Kwajalein','Libya','MET','MST','MST7MDT','Mexico/BajaNorte','Mexico/BajaSur','Mexico/General','NZ','NZ-CHAT','Navajo','PRC','PST8PDT','Pacific/Apia','Pacific/Auckland','Pacific/Bougainville','Pacific/Chatham','Pacific/Chuuk','Pacific/Easter','Pacific/Efate','Pacific/Enderbury','Pacific/Fakaofo','Pacific/Fiji','Pacific/Funafuti','Pacific/Galapagos','Pacific/Gambier','Pacific/Guadalcanal','Pacific/Guam','Pacific/Honolulu','Pacific/Johnston','Pacific/Kanton','Pacific/Kiritimati','Pacific/Kosrae','Pacific/Kwajalein','Pacific/Majuro','Pacific/Marquesas','Pacific/Midway','Pacific/Nauru','Pacific/Niue','Pacific/Norfolk','Pacific/Noumea','Pacific/Pago_Pago','Pacific/Palau','Pacific/Pitcairn','Pacific/Pohnpei','Pacific/Ponape','Pacific/Port_Moresby','Pacific/Rarotonga','Pacific/Saipan','Pacific/Samoa','Pacific/Tahiti','Pacific/Tarawa','Pacific/Tongatapu','Pacific/Truk','Pacific/Wake','Pacific/Wallis','Pacific/Yap','Poland','Portugal','ROC','ROK','Singapore','Turkey','UCT','US/Alaska','US/Aleutian','US/Arizona','US/Central','US/East-Indiana','US/Eastern','US/Hawaii','US/Indiana-Starke','US/Michigan','US/Mountain','US/Pacific','US/Samoa','UTC','Universal','W-SU','WET','Zulu'])
  AND EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_zone),false);
$body$;
CREATE FUNCTION candidate_operations.configuration_department_in_use(p_store text,p_department text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $body$
 SELECT EXISTS(SELECT 1 FROM candidate_identity.memberships WHERE restaurant_id=p_store AND department=p_department) OR
  EXISTS(SELECT 1 FROM candidate_identity.job_assignments j JOIN candidate_identity.memberships m ON m.id=j.membership_id WHERE m.restaurant_id=p_store AND j.department=p_department) OR
  EXISTS(SELECT 1 FROM candidate_operations.shift_references WHERE restaurant_id=p_store AND department=p_department) OR
  EXISTS(SELECT 1 FROM candidate_operations.staffing_needs WHERE restaurant_id=p_store AND department=p_department) OR
  EXISTS(SELECT 1 FROM candidate_operations.closes WHERE restaurant_id=p_store AND department=p_department) OR
  EXISTS(SELECT 1 FROM candidate_operations.station_references WHERE restaurant_id=p_store AND department=p_department) OR
  EXISTS(SELECT 1 FROM candidate_operations.employee_goals WHERE restaurant_id=p_store AND department=p_department) OR
  EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE restaurant_id=p_store AND department=p_department) OR
  EXISTS(SELECT 1 FROM candidate_operations.standard_references WHERE restaurant_id=p_store AND department=p_department) OR
  EXISTS(SELECT 1 FROM candidate_operations.leadership_references WHERE restaurant_id=p_store AND department=p_department) OR
  EXISTS(SELECT 1 FROM candidate_operations.availability_references WHERE restaurant_id=p_store AND department=p_department) OR
  EXISTS(SELECT 1 FROM candidate_operations.schedule_offers WHERE restaurant_id=p_store AND department=p_department AND status IN ('open','pending','accepted-by-replacement'));
$body$;
CREATE FUNCTION candidate_operations.configuration_timezone_in_use(p_store text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $body$
 SELECT EXISTS(SELECT 1 FROM candidate_operations.shift_references WHERE restaurant_id=p_store) OR
  EXISTS(SELECT 1 FROM candidate_operations.dish_cycles WHERE restaurant_id=p_store) OR
  EXISTS(SELECT 1 FROM candidate_operations.employee_goals WHERE restaurant_id=p_store) OR
  EXISTS(SELECT 1 FROM candidate_operations.time_off_references WHERE restaurant_id=p_store) OR
  EXISTS(SELECT 1 FROM candidate_operations.leadership_references WHERE restaurant_id=p_store) OR
  EXISTS(SELECT 1 FROM candidate_operations.availability_references WHERE restaurant_id=p_store) OR
  EXISTS(SELECT 1 FROM candidate_operations.staffing_needs WHERE restaurant_id=p_store) OR
  EXISTS(SELECT 1 FROM candidate_operations.tasks WHERE restaurant_id=p_store);
$body$;
CREATE OR REPLACE FUNCTION candidate_operations.validate_store_configuration() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
BEGIN
 -- Routine workspace revision writes retain the already validated configuration.
 -- Avoid enumerating timezone names for every operational command.
 IF TG_OP='UPDATE' AND ROW(OLD.timezone,OLD.operating_departments,OLD.dish_department,OLD.dish_position,OLD.dish_aliases)
  IS NOT DISTINCT FROM ROW(NEW.timezone,NEW.operating_departments,NEW.dish_department,NEW.dish_position,NEW.dish_aliases) THEN
  RETURN NEW;
 END IF;
 IF NOT candidate_operations.configuration_timezone_valid(NEW.timezone) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_store_timezone';
 END IF;
 IF NEW.operating_departments IS NULL OR cardinality(NEW.operating_departments) NOT BETWEEN 1 AND 16
 OR array_ndims(NEW.operating_departments) IS DISTINCT FROM 1
 OR EXISTS(SELECT 1 FROM unnest(NEW.operating_departments) v WHERE NOT candidate_operations.configuration_label_valid(v))
 OR (SELECT count(DISTINCT v) FROM unnest(NEW.operating_departments) v)<>cardinality(NEW.operating_departments)
 OR NEW.dish_department IS NULL OR NOT NEW.dish_department=ANY(NEW.operating_departments)
 OR NOT candidate_operations.configuration_label_valid(NEW.dish_position)
 OR NEW.dish_aliases IS NULL OR cardinality(NEW.dish_aliases) NOT BETWEEN 1 AND 64 OR array_ndims(NEW.dish_aliases) IS DISTINCT FROM 1
 OR EXISTS(SELECT 1 FROM unnest(NEW.dish_aliases) v WHERE NOT candidate_operations.configuration_label_valid(v))
 OR (SELECT count(DISTINCT lower(regexp_replace(btrim(v),'\s+',' ','g'))) FROM unnest(NEW.dish_aliases) v)<>cardinality(NEW.dish_aliases)
 OR NOT EXISTS(SELECT 1 FROM unnest(NEW.dish_aliases) v WHERE lower(regexp_replace(v,'\s+',' ','g'))=lower(regexp_replace(NEW.dish_position,'\s+',' ','g'))) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_store_configuration';
 END IF;
 IF TG_OP='UPDATE' AND ROW(OLD.timezone,OLD.operating_departments,OLD.dish_department,OLD.dish_position,OLD.dish_aliases)
  IS DISTINCT FROM ROW(NEW.timezone,NEW.operating_departments,NEW.dish_department,NEW.dish_position,NEW.dish_aliases) THEN
  IF OLD.timezone IS DISTINCT FROM NEW.timezone AND candidate_operations.configuration_timezone_in_use(OLD.id) THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='store_timezone_in_use';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(OLD.operating_departments) d WHERE NOT d=ANY(NEW.operating_departments)
   AND candidate_operations.configuration_department_in_use(OLD.id,d)) THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='store_department_in_use';
  END IF;
  -- Changing role interpretation under existing people/history needs a separate explicit port.
  IF ROW(OLD.dish_department,OLD.dish_position,OLD.dish_aliases) IS DISTINCT FROM ROW(NEW.dish_department,NEW.dish_position,NEW.dish_aliases)
   AND (EXISTS(SELECT 1 FROM candidate_identity.memberships WHERE restaurant_id=OLD.id)
    OR EXISTS(SELECT 1 FROM candidate_operations.shift_references WHERE restaurant_id=OLD.id)
    OR EXISTS(SELECT 1 FROM candidate_operations.dish_cycles WHERE restaurant_id=OLD.id)
    OR EXISTS(SELECT 1 FROM candidate_operations.station_references WHERE restaurant_id=OLD.id)) THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='store_role_configuration_in_use';
  END IF;
  NEW.revision:=greatest(OLD.revision+1,NEW.revision);
  UPDATE candidate_operations.schedule_input_reviews SET time_off_complete=false,evidence_batch_id=NULL,reviewed_at=NULL WHERE restaurant_id=OLD.id;
 END IF;
 RETURN NEW;
END;
$body$;
CREATE FUNCTION candidate_operations.validate_checkout_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
BEGIN
 IF candidate_operations.dish_only_label(NEW.restaurant_id,NEW.position)
  AND NOT candidate_operations.is_dish_position(NEW.restaurant_id,NEW.position) THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='checkout_position_not_canonical';
 END IF;
 RETURN NEW;
END;
$body$;
-- aa_coordinate_policy acquires both source/destination scopes before this guard.
CREATE TRIGGER ab_validate_checkout_membership BEFORE INSERT OR UPDATE ON candidate_identity.memberships
 FOR EACH ROW EXECUTE FUNCTION candidate_operations.validate_checkout_membership();
REVOKE ALL ON FUNCTION candidate_operations.configuration_label_valid(text),candidate_operations.configuration_timezone_valid(text),
 candidate_operations.configuration_department_in_use(text,text),candidate_operations.configuration_timezone_in_use(text),
 candidate_operations.validate_checkout_membership() FROM PUBLIC,candidate_runtime;
-- Reject ambiguous historical mappings. Reconciliation must be explicitly reviewed,
-- never silently normalize positions or rewrite existing work during this migration.
DO $preflight$
DECLARE r candidate_identity.restaurants;
BEGIN
 FOR r IN SELECT * FROM candidate_identity.restaurants LOOP
  IF NOT candidate_operations.configuration_timezone_valid(r.timezone) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_store_timezone';
  END IF;
  IF NOT candidate_operations.configuration_label_valid(r.dish_position)
   OR EXISTS(SELECT 1 FROM unnest(r.operating_departments||r.dish_aliases) v WHERE NOT candidate_operations.configuration_label_valid(v)) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_store_configuration';
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM candidate_identity.memberships m WHERE candidate_operations.dish_only_label(m.restaurant_id,m.position)
  AND NOT candidate_operations.is_dish_position(m.restaurant_id,m.position)) THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='checkout_position_not_canonical';
 END IF;
END;
$preflight$;
COMMIT;
