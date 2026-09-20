import { createAI } from '../src/ai.mjs';
const calls=[];
const ai=createAI({getSettings:()=>({ai:{dailyCallLimit:3,monthlyBudget:0},fetch:{enabled:true}}),getSecret:()=>'',getUsage:()=>({callsToday:calls.length,costMonth:0}),recordCall:call=>calls.push(call)});
try {
  const result=await ai.readPage({url:'https://example.com/',privacy:'cloud'});
  if(!result.text.includes('Example Domain'))throw new Error('页面未包含预期的实际正文。');
  console.log(JSON.stringify({passed:true,url:result.url,title:result.title,excerpt:result.text.slice(0,150),fetchedAt:result.fetchedAt,calls:calls.map(({capability,ok,durationMs,cost})=>({capability,ok,durationMs,cost})),scope:'只验证公开网页读取；没有模型、搜索或嵌入调用。'},null,2));
} catch(error){console.error(JSON.stringify({passed:false,code:error.code,error:error.message,scope:'公网读取失败，未伪造结果。'}));process.exitCode=1;}
