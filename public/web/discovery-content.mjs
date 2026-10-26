// Authored examples for the isolated learning-feed preview; never imported into the user's library automatically.
const anki={title:'Anki · Studying',url:'https://docs.ankiweb.net/manual/studying'};
const rules={title:'SuperMemo · Twenty rules',url:'https://www.super-memory.org/archive/articles/20rules.htm'};
const rfc=(section,name)=>({title:`RFC 9110 · ${section}`,url:`https://www.rfc-editor.org/rfc/rfc9110.html#name-${name}`});

export const discoverySeeds=[
 {
  key:'recall',topic:'记忆与学习',title:'看懂了，也要试着想起来',
  body:'重读时，熟悉的词句会提供线索。合上材料，用自己的话尝试回忆，才更容易发现自己还说不清的部分。先尝试，再核对遗漏；需要时回看材料，并如实记录用过提示。一次顺利回答也不等于长期掌握。',sources:[anki,rules],
  cards:[
   {id:'recall-lesson',type:'lesson',title:'把眼熟，变成自己的解释',intro:'合上材料的那一刻，才看得见缺口。',prerequisites:[],pages:[
    {title:'熟悉，不等于能想起',body:'看着原句时，页面在替你提供线索。离开材料后，能否说出核心意思，是另一个问题。'},
    {title:'先留一份自己的回答',body:'读完一个概念，合上材料，写一句解释或举一个例子。想不起来也可以停下来，不必用猜测填满空白。'},
    {title:'只补这次暴露的缺口',body:'重新打开材料，对照遗漏和误解，再修正回答。保留原回答，才能看见自己改了什么。',takeaway:'先独立尝试，再有针对性地回看。'}]},
   {id:'recall-quiz',type:'quiz',title:'朋友说“这页我都懂了”',question:'怎样更直接地了解他能否独立解释这页内容？',prerequisites:['recall-lesson'],correctOptionId:'explain',options:[
    {id:'reread',text:'让他再读三遍',explanation:'重复阅读增加了接触次数，但没有直接检查离开材料后的解释。'},
    {id:'highlight',text:'让他把重点全部划出来',explanation:'划线能标记材料，却不能替代独立作答。'},
    {id:'explain',text:'请他合上材料，解释并举例',explanation:'离开材料后解释并举例，可以暴露具体缺口。'},
    {id:'recognize',text:'问他这些句子是否都很熟悉',explanation:'熟悉感和独立回忆是不同证据。'}]}
  ]
 },
 {
  key:'rating',topic:'记忆与学习',title:'自评，要对准揭晓前的表现',
  body:'按 Anki 的自评规则，答错或没想起时选择 Again；答对但费力时才选 Hard。看过答案后的熟悉感，不能倒推成揭晓前已经记得。先学和复习要分开记录；本地示例的间隔只是预览安排，不是正式记忆算法。',sources:[anki],
  cards:[
   {id:'rating-flash',type:'flash',title:'答错时，该选哪一档？',question:'按 Anki 规则，揭晓前答错或没想起，应选哪一档？',answer:'Again（没想起）',explanation:'Hard 表示答对了但费力，不是答错时的替代选项。请按揭晓前的表现自评。',prerequisites:[]},
   {id:'rating-quiz',type:'quiz',title:'看答案后，突然觉得很熟悉',question:'小林揭晓前答错了，看见答案后觉得“我其实知道”。这次怎样记录更准确？',prerequisites:[],correctOptionId:'again',options:[
    {id:'easy',text:'很轻松，因为答案一看就懂',explanation:'揭晓后的熟悉感不能证明揭晓前的回忆成功。'},
    {id:'hard',text:'费力想起，因为只差一点',explanation:'费力想起要求答案正确；这次原回答是错误的。'},
    {id:'again',text:'没想起，之后再独立尝试',explanation:'原回答答错，应保留这一证据，再安排后续回忆。'},
    {id:'delete',text:'删除原回答，只保留修正答案',explanation:'删除原回答会丢失这次误解与修正过程。'}]}
  ]
 },
 {
  key:'small-card',topic:'记忆与学习',title:'一张闪卡，只检验一件事',
  body:'先建立理解，再把值得记忆的内容写成明确的小问题。整段定义塞进一张卡，容易出现记住一半却不知道怎样自评的情况。拆成几个独立问题，各自保留上下文和来源，才能分别记录回忆表现。不要把开放讨论题伪装成只有一个答案的事实卡。',sources:[rules],
  cards:[
   {id:'small-card-compare',type:'compare',title:'整段背诵，还是一个明确问题？',intro:'拆小的是检验单位，不是删掉必要条件。',prerequisites:[],compare:{leftLabel:'整段塞进一张卡',rightLabel:'一个明确问题',rows:[
    {label:'如何判断',left:'只记得一半，难以自评',right:'知道这一次检验哪一点'},
    {label:'复习安排',left:'整段一起重复',right:'每个缺口分别安排'},
    {label:'保留背景',left:'背景与答案混在一起',right:'问题给必要条件，详情保留背景'}]}}
  ]
 },
 {
  key:'http-404',topic:'网络常识',title:'404，没有说明网页永远消失了',
  body:'HTTP 的 404 状态名为 Not Found。它可能表示服务器没有找到资源的当前表示，也可能表示服务器不愿透露资源存在。404 本身不能说明这种情况是否永久。若服务器知道资源已不可用且很可能永久如此，410 Gone 更适合表达这一点。',sources:[rfc('15.5.5','404-not-found'),rfc('15.5.11','410-gone')],
  cards:[
   {id:'404-lesson',type:'lesson',title:'读懂 404 留下的边界',intro:'状态码给了线索，也留下了未知。',prerequisites:[],pages:[
    {title:'先读它确实说了什么',body:'404 的名称是 Not Found。服务器没有找到资源的当前表示，或不愿透露它存在。'},
    {title:'再看它没有说什么',body:'同一个地址今天返回 404，不能仅凭这个响应断定它明天仍不可用，也不能断定它以前从未存在。'},
    {title:'让判断停在证据边界',body:'是否永久不可用，需要额外依据。410 用于表达资源已不可用、且这种情况很可能是永久的。',takeaway:'404 不是“已永久删除”的证明。'}]},
   {id:'404-quiz',type:'quiz',title:'一个旧链接返回了 404',question:'仅凭这个响应，哪句话更有依据？',prerequisites:['404-lesson'],correctOptionId:'limited',options:[
    {id:'forever',text:'网页一定被永久删除了',explanation:'404 没有承诺这种状态是永久的。'},
    {id:'never',text:'这个网页从未存在过',explanation:'当前响应无法证明资源过去从未存在。'},
    {id:'limited',text:'无法据此确定是否永久不可用',explanation:'404 的边界正是在这里：它不区分临时和永久。'},
    {id:'attack',text:'服务器一定受到了攻击',explanation:'状态码本身没有提供这个因果判断的证据。'}]},
   {id:'404-flash',type:'flash',title:'Not Found 的状态码',question:'HTTP 中，Not Found 对应哪个状态码？',answer:'404',explanation:'记住名称与代码的对应，也保留边界：404 不能单独证明资源永久消失。',prerequisites:['404-lesson']}
  ]
 },
 {
  key:'http-403',topic:'网络常识',title:'403 和 404，别只看成“打不开”',
  body:'403 Forbidden 表示服务器理解了请求，但拒绝执行。404 Not Found 表示没有找到资源的当前表示，或不愿透露它存在。服务器可以为了隐藏被禁止资源的存在而返回 404。因此，不能简单地把 403 等同于资源存在、把 404 等同于资源不存在。',sources:[rfc('15.5.4','403-forbidden'),rfc('15.5.5','404-not-found')],
  cards:[
   {id:'403-compare',type:'compare',title:'拒绝执行，与未找到',intro:'相似的页面结果，不代表相同的响应含义。',prerequisites:[],compare:{leftLabel:'403 · Forbidden',rightLabel:'404 · Not Found',rows:[
    {label:'核心含义',left:'理解请求，但拒绝执行',right:'未找到当前表示，或不愿透露存在'},
    {label:'不能推出',left:'只换一个密码就必然成功',right:'资源从未存在或已永久删除'},
    {label:'可重叠处',left:'被禁止的资源可以被隐藏',right:'可用于隐藏被禁止资源的存在'}]}},
   {id:'403-quiz',type:'quiz',title:'权限受限，也可能是 404',question:'服务器想隐藏一个被禁止资源的存在。根据 HTTP 语义，它可以怎样响应？',prerequisites:[],correctOptionId:'hide',options:[
    {id:'always403',text:'只能返回 403',explanation:'规范允许服务器用 404 隐藏被禁止资源的存在。'},
    {id:'hide',text:'可以返回 404',explanation:'404 可以承担不愿透露资源存在的语义。'},
    {id:'success',text:'必须返回 200',explanation:'200 并不表达这里的拒绝或隐藏语义。'},
    {id:'forever',text:'必须返回 410',explanation:'410 表达资源不可用且很可能永久，不是隐藏权限状态的要求。'}]}
  ]
 },
 {
  key:'http-304',topic:'网络常识',title:'304：这次不用重传正文',
  body:'304 的状态名为 Not Modified。它出现在符合条件的 GET 或 HEAD 请求中，用于让客户端复用已有的有效表示，而不是再传一份完整正文。304 响应不包含消息内容。这里的前提是客户端已有可复用的表示，不能把任意空白响应都理解成缓存命中。',sources:[rfc('15.4.5','304-not-modified')],
  cards:[
   {id:'304-lesson',type:'lesson',title:'服务器为什么没有再发一遍？',intro:'少传一份正文，也可以完成一次有效协作。',prerequisites:[],pages:[
    {title:'客户端已经有一份内容',body:'浏览器保存过资源，再发起带条件的 GET 或 HEAD 请求，询问已有表示是否仍可使用。'},
    {title:'服务端让它复用已有表示',body:'条件满足相应规则时，服务器用 304 告诉客户端使用已保存的有效表示，不再传完整正文。'},
    {title:'别漏掉前提',body:'304 的意义建立在条件请求与已有表示上。它不包含消息内容；空白响应本身不是 304 的充分证据。',takeaway:'304 让客户端复用已有表示。'}]},
   {id:'304-flash',type:'flash',title:'Not Modified 的状态码',question:'HTTP 中，Not Modified 对应哪个状态码？',answer:'304',explanation:'在相应的条件请求中，304 让客户端使用已有的有效表示；响应不包含消息内容。',prerequisites:['304-lesson']}
  ]
 }
];
