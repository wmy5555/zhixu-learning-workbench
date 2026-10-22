import { Unzip, UnzipInflate } from 'fflate';
const failure = reason => ({status:'failed',text:'',warnings:[reason+'；原文件保留。'],tool:'bounded-docx-xml'});
export async function extractWordDocument(file) {
  if(file.descriptor.format!=='docx')return {status:'unsupported',text:'',warnings:['旧版 DOC 仅保存原件；请另存为 DOCX 后导入。'],tool:null};
  let count=0,total=0,xml='',error=null,complete=false;
  const unzip=new Unzip(entry=>{
    if(++count>1000||entry.name.includes('..')||entry.name.startsWith('/')||entry.name.includes('\\')){error='压缩文档目录无效或项目过多';return;}
    if(entry.originalSize>8*1024*1024){error='文档解压尺寸超过限制';return;}
    if(entry.name!=='word/document.xml')return;
    const chunks=[];
    entry.ondata=(err,data,final)=>{
      if(err){error='文档无法解压';return;}
      total+=data.length;
      if(total>8*1024*1024){error='文档解压尺寸超过限制';entry.terminate();return;}
      chunks.push(data);
      if(final){const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);complete=true;}
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  try {
    for(let i=0;i<file.bytes.length;i+=65536){unzip.push(file.bytes.subarray(i,i+65536),i+65536>=file.bytes.length);if(error)return failure(error);if(i%524288===0)await new Promise(r=>setTimeout(r,0));}
    if(!complete||!xml)return failure('未找到完整 Word 正文');
    if(/<!DOCTYPE|<!ENTITY/i.test(xml))return failure('不接受带外部实体的 Word XML');
    const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
    const text=xml.replace(/<w:(?:tab)\b[^>]*\/>/g,'\t').replace(/<w:(?:br|cr)\b[^>]*\/>/g,'\n').replace(/<\/w:p>/g,'\n').replace(/<[^>]+>/g,'').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,key)=>key.startsWith('#')?String.fromCodePoint(key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1))):named[key]).trim();
    if(!text||text.length>500000)return failure('提取文本为空或超过 50 万字符');
    return {status:'ready',text,warnings:[],tool:'bounded-docx-xml'};
  }catch{return failure('Word 文件损坏或编码无效');}
}
