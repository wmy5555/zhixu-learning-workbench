import ipaddr from 'ipaddr.js';
export const isIP = value => { try { return ipaddr.parse(value).kind()==='ipv4'?4:6; } catch { return 0; } };
export class BlockList {
  subnets=[];
  addSubnet(value,prefix) { this.subnets.push([ipaddr.parse(value),prefix]); }
  check(value) { try { const ip=ipaddr.parse(value); return this.subnets.some(([net,bits])=>net.kind()===ip.kind()&&ip.match(net,bits)); } catch{return true;} }
}
export function connect() { throw Object.assign(Error('ChatGPT 桌面管道需在电脑运行。手机通过文件协作。'),{code:'DESKTOP_ONLY'}); }
export default { isIP,BlockList,connect };
