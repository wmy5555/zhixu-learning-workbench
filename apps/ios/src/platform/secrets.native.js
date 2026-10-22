import runtime from './runtime.native.js';
import { credentialBinding } from '../core/settings-validation.mjs';
export function createSecrets(dataDir,{db,getBinding}={}) {
  db.exec('CREATE TABLE IF NOT EXISTS encrypted_credentials (capability TEXT PRIMARY KEY,json TEXT NOT NULL)');
  const stored=capability=>{const row=db.prepare('SELECT json FROM encrypted_credentials WHERE capability=?').get(capability);return row?JSON.parse(row.json):null;};
  const usable=(capability,value)=>!!value&&JSON.stringify(value.binding)===JSON.stringify(getBinding(capability));
  return {
    has:capability=>usable(capability,stored(capability)),
    get(capability,config){const s=stored(capability);if(!usable(capability,s)||config&&JSON.stringify(s.binding)!==JSON.stringify(credentialBinding(config)))return '';return runtime.openSecret(s.value);},
    prepare(changes){return changes.map(c=>({capability:c.capability,value:c.clear?null:{type:'ios-keychain-aes',value:runtime.sealSecret(c.value),binding:c.binding??getBinding(c.capability)}}));},
    apply(changes){for(const {capability,value} of changes){if(value===null)db.prepare('DELETE FROM encrypted_credentials WHERE capability=?').run(capability);else db.prepare('INSERT INTO encrypted_credentials VALUES(?,?) ON CONFLICT(capability) DO UPDATE SET json=excluded.json').run(capability,JSON.stringify(value));}},
    set(capability,value,config){if(value)this.apply(this.prepare([{capability,value,...(config?{binding:credentialBinding(config)}:{})}]));},
    clear(capability){this.apply([{capability,value:null}]);}
  };
}
