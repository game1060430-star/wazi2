function bankFeatureEnabled(){return get('bankFeature').enabled!==false;}
function applyBankFeatureVisibility(){
 const enabled=bankFeatureEnabled();
 for(const id of ['bankEntryForm','dailyBankDetails','bankTabButton','paymentDepositPanel']){const el=document.getElementById(id);if(el)el.style.display=enabled?'':'none';}
 const checkbox=document.getElementById('sBankEnabled');if(checkbox)checkbox.checked=enabled;
 const page=document.getElementById('bank');
 if(!enabled&&page?.classList?.contains('active'))switchTab('daily');
}
function saveBankFeatureSetting(){
 set('bankFeature',{enabled:document.getElementById('sBankEnabled').checked});
 applyBankFeatureVisibility();showSaveToast(bankFeatureEnabled()?'已開啟銀行出入帳':'已關閉銀行出入帳');
}
// Independent bank cash ledger. Revenue remains in the original daily ledger.
let bankFormDate='';
let bankMiscSelected=new Set(),bankFixedSelected=new Set();
let bankVendorSelected=new Map(),bankVendorSelectionMode=false;
function bankConfig(){const c=get('bankConfig');return Array.isArray(c)?{name:'銀行帳戶',opening:0,inFee:0,outFee:0}:c;}
let paymentDepositSelected=new Set();
function paymentDepositSources(){
 const rows=[];for(const key of Object.keys(localStorage).filter(key=>key.startsWith(KEY+'d_')).sort()){
  const date=key.slice((KEY+'d_').length);if(!bankValidDate(date))continue;const d=JSON.parse(localStorage.getItem(key))||{},rates=d.paymentFeeRates||{};
  const amounts={pOnline:num(d.pOnline),pScan:num(d.pScan),...(d.payments||{})},names={pOnline:cfg().onlineName||'網路收入',pScan:cfg().scanName||'掃碼支付',...Object.fromEntries(paymentItems().map(p=>[p.id,p.name])),...(d.paymentNames||{})};
  const items=Object.entries(amounts).filter(([,amount])=>num(amount)>0).map(([channel,amount])=>({id:date+'_'+channel,date,channel,name:names[channel]||channel,amount:Math.round(num(amount)),exactFee:Math.round(num(amount)*feeRate(rates[channel]))/100}));
  const target=paymentSettlement(d).fees;let remaining=target-items.reduce((sum,item)=>sum+Math.floor(item.exactFee),0);
  const order=[...items].sort((a,b)=>(b.exactFee%1)-(a.exactFee%1)||a.id.localeCompare(b.id));const extra=new Set(order.slice(0,Math.max(0,remaining)).map(item=>item.id));
  rows.push(...items.map(item=>({...item,fee:Math.floor(item.exactFee)+(extra.has(item.id)?1:0)})));
 }return rows;
}
function bankEntries(){
 const sources=new Map(paymentDepositSources().map(row=>[row.id,row]));return get('bankEntries').filter(e=>!e.automatic).map(e=>{
  if(!e.paymentRefs?.length)return e;const rows=e.paymentRefs.map(ref=>sources.get(ref.id)).filter(Boolean);return {...e,amount:rows.reduce((sum,row)=>sum+row.amount,0),fee:rows.reduce((sum,row)=>sum+row.fee,0)};
 });
}
function pendingPaymentDeposits(date,entries=bankEntries()){
 const paid=new Set(entries.filter(e=>!e.deleted).flatMap(e=>(e.paymentRefs||[]).map(ref=>ref.id)));return paymentDepositSources().filter(row=>row.date<=date&&!paid.has(row.id));
}
function renderPaymentDeposits(){
 const dateInput=document.getElementById('paymentDepositDate');if(!dateInput)return;if(!dateInput.value)dateInput.value=document.getElementById('logDate').value;
 const rows=pendingPaymentDeposits(dateInput.value),ids=new Set(rows.map(row=>row.id));paymentDepositSelected=new Set([...paymentDepositSelected].filter(id=>ids.has(id)));
 const box=document.getElementById('paymentDepositChoices');box.innerHTML=rows.map(row=>`<label class="check-row"><input type="checkbox" class="payment-deposit-check" value="${escapeHtml(row.id)}" ${paymentDepositSelected.has(row.id)?'checked':''}>${escapeHtml(row.date)} ${escapeHtml(row.name)} · 實收 ${money(row.amount-row.fee)}（費 ${money(row.fee)}）</label>`).join('')||'<div class="report-note">沒有待入帳支付。</div>';
 const update=()=>{const chosen=rows.filter(row=>paymentDepositSelected.has(row.id));document.getElementById('paymentDepositTotal').textContent='已選 '+chosen.length+' 筆 · 入帳 '+money(chosen.reduce((sum,row)=>sum+row.amount-row.fee,0));};box.querySelectorAll('.payment-deposit-check').forEach(input=>input.onchange=()=>{input.checked?paymentDepositSelected.add(input.value):paymentDepositSelected.delete(input.value);update();});update();
}
function validatePaymentDeposits(entries){const used=new Set();for(const e of entries){if(e.deleted)continue;for(const ref of e.paymentRefs||[]){if(used.has(ref.id)||ref.date>e.date||e.kind!=='in')throw Error('支付已入帳或入帳日期早於交易日');used.add(ref.id);}}}
function confirmPaymentDeposit(){try{
 if(!bankFeatureEnabled())throw Error('請先在設定開啟銀行出入帳');clearTimeout(scheduleDailyAutosave.timer);if(saveDaily(true)===false)return;
 const date=document.getElementById('paymentDepositDate').value;if(!bankValidDate(date))throw Error('請選擇有效入帳日期');const rows=pendingPaymentDeposits(date).filter(row=>paymentDepositSelected.has(row.id));if(!rows.length||rows.length!==paymentDepositSelected.size)throw Error('請勾選尚未入帳的支付');
 const entry={id:'deposit_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),date,kind:'in',category:'payment',amount:rows.reduce((sum,row)=>sum+row.amount,0),fee:rows.reduce((sum,row)=>sum+row.fee,0),paymentRefs:rows.map(({id,date,channel,name})=>({id,date,channel,name})),memo:'已確認收到支付款項'};
 const entries=[...bankEntries(),entry];validatePaymentDeposits(entries);paymentDepositSelected=new Set();document.getElementById('bankMonth').value=date.slice(0,7);bankCommit(bankConfig(),entries);showSaveToast('已記錄支付入帳');
 }catch(e){showSaveToast(e.message);}}
function bankInteger(value){const n=Number(value);if(!Number.isFinite(n)||!Number.isSafeInteger(n))throw Error('金額請輸入整數元');return n;}
function bankValidDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
function bankDelta(entry){if(entry.paymentSource==='till'||entry.paymentSource==='external')return 0;return entry.kind==='adjust'?entry.amount:entry.kind==='in'?entry.amount-entry.fee:-entry.amount-entry.fee;}
function bankSummary(month,entries=bankEntries(),c=bankConfig()){
 let opening=c.opening||0,income=0,outgoing=0,fees=0,adjustment=0,purchases=0,sales=0,vendorPayments=0,cashPayments=0;
 const rows=[];let running=opening;
 for(const e of [...entries].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))){
  if(e.deleted)continue;const delta=bankDelta(e),m=e.date.slice(0,7);if(m<month)opening+=delta;
  if(m<=month)running+=delta;
  if(m!==month)continue;
  if(e.paymentSource==='till'||e.paymentSource==='external'){cashPayments+=e.amount;rows.push({...e,delta,balance:running});continue;}
  if(e.kind==='in')income+=e.amount;else if(e.kind==='out')outgoing+=e.amount;else adjustment+=e.amount;
  fees+=e.fee;if(e.category==='purchase')purchases+=e.amount;if(e.category==='sale')sales+=e.amount;if(e.vendor)vendorPayments+=e.amount;
  rows.push({...e,delta,balance:running});
 }
 return {opening,income,outgoing,fees,adjustment,purchases,sales,vendorPayments,cashPayments,balance:opening+income-outgoing-fees+adjustment,rows};
}
function bankCommit(config,entries){
 entries=entries.filter(e=>!e.automatic);validatePaymentDeposits(entries);const before={config:bankConfig(),entries:get('bankEntries').filter(e=>!e.automatic)},after={config,entries};const history=get('bankUndo');
 history.push({before,after});set('bankUndo',history.slice(-20));set('bankConfig',config);set('bankEntries',entries);renderBank();syncBankVendorViews();
}
function bankUndo(){const history=get('bankUndo');if(!history.length)return showSaveToast('沒有可復原的銀行修改');const last=history[history.length-1];if(JSON.stringify({config:bankConfig(),entries:get('bankEntries').filter(e=>!e.automatic)})!==JSON.stringify(last.after))return showSaveToast('銀行資料已變動，無法復原');try{validateBankVendorInvoices(last.before.entries);validateBankMiscPayments(last.before.entries);validateBankFixedPayments(last.before.entries);validatePaymentDeposits(last.before.entries);}catch(e){showSaveToast(e.message);return;}history.pop();set('bankUndo',history);set('bankConfig',last.before.config);set('bankEntries',last.before.entries);resetBankForm();renderBank();syncBankVendorViews();showSaveToast('已復原銀行修改');}
function saveBankConfig(){try{const name=document.getElementById('bankName').value.trim()||'銀行帳戶',opening=bankInteger(document.getElementById('bankOpening').value),inFee=bankInteger(document.getElementById('bankInFee').value),outFee=bankInteger(document.getElementById('bankOutFee').value);if(inFee<0||outFee<0)throw Error('手續費不能小於 0');bankCommit({name,opening,inFee,outFee},bankEntries());resetBankForm();showSaveToast('銀行設定已儲存');}catch(e){showSaveToast(e.message);}}
function bankKindChanged(useDefault=true){
 const kind=document.getElementById('bankKind').value,c=bankConfig(),adjust=kind==='adjust',fee=kind==='in'?c.inFee:c.outFee;
 document.getElementById('bankFeeToggle').style.display=adjust?'none':'flex';document.getElementById('bankCategoryGroup').style.display=adjust?'none':'block';document.getElementById('bankAdjustModeGroup').style.display=adjust?'block':'none';
 document.getElementById('bankMemoLabel').textContent=adjust?'調整原因（必填）':'備註';document.getElementById('bankMemo').required=adjust;
 document.getElementById('bankCategory').innerHTML=adjust?'<option value="general">餘額修正</option>':kind==='in'?'<option value="general">一般入帳</option><option value="sale">出貨收入</option>':'<option value="general">一般出帳</option><option value="vendor">支付廠商欠款</option><option value="purchase">進貨支出</option><option value="misc">支付雜支</option><option value="fixed">支付固定支出</option><option value="salary">支付薪資</option>';
 if(useDefault){document.getElementById('bankHasFee').checked=!adjust&&fee>0;document.getElementById('bankFee').value=fee||0;document.getElementById('bankAdjustMode').value='target';}
 bankCategoryChanged();toggleBankFee();
}
function bankBalanceAsOf(date,excludeId='',entries=bankEntries()){return num(bankConfig().opening)+entries.filter(e=>!e.deleted&&e.id!==excludeId&&e.date<=date).reduce((sum,e)=>sum+bankDelta(e),0);}
function bankCategoryChanged(){const linked=document.getElementById('bankKind').value==='out'&&document.getElementById('bankCategory').value==='vendor';document.getElementById('bankVendorGroup').style.display=linked?'block':'none';renderBankVendorOptions();previewBankVendor();renderBankMiscChoices();renderBankFixedChoices();renderBankVendorInvoices();}
function renderBankVendorOptions(){const input=document.getElementById('bankVendor'),selected=input.value;input.innerHTML='<option value="">選擇廠商</option>'+get('vendors').map(v=>`<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)}</option>`).join('');input.value=selected;}
function previewBankVendor(){const name=document.getElementById('bankVendor').value,date=document.getElementById('bankDate').value||document.getElementById('logDate').value,id=document.getElementById('bankEditId').value,linked=document.getElementById('bankKind').value==='out'&&document.getElementById('bankCategory').value==='vendor',amount=num(document.getElementById('bankAmount').value);const debt=linked&&name?vendorBalance(name,date,id).unpaid:0;document.getElementById('bankVendorDebt').textContent=linked&&name?`未結清 ${money(debt)} · 付款後剩餘 ${money(Math.max(0,debt-amount))}`:'';}
function validateBankVendorPayments(entries){
 for(const e of entries){if(e.deleted||!e.vendor)continue;
  const last=get('vendorSettlements').filter(x=>x.name===e.vendor&&x.date<=e.date).map(x=>x.date).sort().at(-1)||'';
  if(last===e.date)continue;
  if(bankVendorPaid(e.vendor,last,e.date,entries)>vendorPeriodAmount(e.vendor,last,e.date)+0.000001)throw Error('付款超過廠商未結清金額，請確認金額及後續付款');
 }
}
function syncBankVendorViews(){updateVendorBalances();calcDaily(true);renderMiscExpenses();renderUnpaidMiscSettlement(document.getElementById('mMonth').value);renderDailyBank();if(document.getElementById('reconMonth').value)renderRecon();if(document.getElementById('rMonth').value)genFullReport();}
function toggleBankFee(){const cash=miscCashSource();document.getElementById('bankFeeToggle').style.display=cash||document.getElementById('bankKind').value==='adjust'?'none':'flex';const show=!cash&&document.getElementById('bankKind').value!=='adjust'&&document.getElementById('bankHasFee').checked;document.getElementById('bankFeeGroup').style.display=show?'block':'none';previewBankDelta();}
function bankFormAdjustment(value){return document.getElementById('bankAdjustMode').value==='target'?value-bankBalanceAsOf(document.getElementById('bankDate').value,document.getElementById('bankEditId').value):value;}
function previewBankDelta(){const kind=document.getElementById('bankKind').value,value=num(document.getElementById('bankAmount').value),amount=kind==='adjust'?bankFormAdjustment(value):value,fee=kind!=='adjust'&&!miscCashSource()&&document.getElementById('bankHasFee').checked?num(document.getElementById('bankFee').value):0;const cash=miscCashSource(),delta=bankDelta({kind,amount,fee,paymentSource:cash});document.getElementById('bankAmountLabel').textContent=kind==='out'&&document.getElementById('bankCategory').value==='vendor'?'本次付款金額（可付部分）':kind==='adjust'?(document.getElementById('bankAdjustMode').value==='target'?'正確銀行餘額':'修正差額（減少填負數）'):'交易金額';document.getElementById('bankAmount').min=kind==='adjust'?'':'0';document.getElementById('bankImpact').textContent=cash?`現金付款 ${money(amount)} · ${cash==='till'?'扣除今日營業額':'另外拿現金，不影響收銀'} · 銀行餘額不變`:kind==='in'?`實際入帳 ${money(delta)}`:kind==='out'?`實際扣款 ${money(-delta)}`:`調整差額 ${delta>=0?'+':''}${money(delta)}`;previewBankVendor();if(!document.getElementById('bankEditId').value)document.getElementById('bankSaveBtn').textContent=kind==='out'?'確認付款':kind==='in'?'確認入帳':'確認餘額修正';}
function resetBankForm(){if(document.getElementById('miscPaymentSource'))document.getElementById('miscPaymentSource').value='bank';bankMiscSelected=new Set();bankFixedSelected=new Set();bankVendorSelected=new Map();bankVendorSelectionMode=false;document.getElementById('bankEditId').value='';document.getElementById('bankDate').value=document.getElementById('logDate').value;document.getElementById('bankKind').value='in';bankFormDate=document.getElementById('logDate').value;document.getElementById('bankAmount').value='';document.getElementById('bankMemo').value='';document.getElementById('bankVendor').value='';document.getElementById('bankSaveBtn').textContent='新增銀行紀錄';document.getElementById('bankCancelBtn').style.display='none';bankKindChanged();}
function saveBankEntry(){try{
 if(!document.getElementById('bankAmount').value.trim())throw Error('請輸入金額');
 const id=document.getElementById('bankEditId').value||'bank_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),date=document.getElementById('bankDate').value,kind=document.getElementById('bankKind').value,inputAmount=bankInteger(document.getElementById('bankAmount').value),amount=kind==='adjust'?bankFormAdjustment(inputAmount):inputAmount,fee=kind!=='adjust'&&!miscCashSource()&&document.getElementById('bankHasFee').checked?bankInteger(document.getElementById('bankFee').value):0,category=kind==='adjust'?'general':document.getElementById('bankCategory').value,memo=document.getElementById('bankMemo').value.trim();
 if(kind==='adjust'&&!memo)throw Error('請填寫餘額調整原因');
 if(!bankValidDate(date))throw Error('請選擇有效日期');if(!['in','out','adjust'].includes(kind))throw Error('請選擇入帳或出帳');if((kind!=='adjust'&&amount<=0)||(kind==='adjust'&&amount===0))throw Error('請輸入有效金額');if(fee<0||(kind==='in'&&fee>amount))throw Error('請確認手續費金額');if((category==='sale'&&kind!=='in')||(category==='purchase'&&kind!=='out'))throw Error('請確認進貨／出貨類別');
 clearTimeout(scheduleDailyAutosave.timer);if(saveDaily(true)===false)throw Error('請先處理已付款進貨單的修改');
 const vendor=kind==='out'&&category==='vendor'?document.getElementById('bankVendor').value:'';if(vendor&&get('vendorSettlements').some(e=>e.name===vendor&&e.date===date))throw Error('該日已勾選結清，請先取消結清再記錄廠商付款');if(category==='vendor'&&(!vendor||!get('vendors').some(v=>v.name===vendor)))throw Error('請選擇付款廠商');
 const invoicePayments=kind==='out'&&category==='vendor'&&bankVendorSelectionMode?selectedVendorInvoices(vendor,date,id):[];if(bankVendorSelectionMode&&category==='vendor'&&(!invoicePayments.length||amount!==invoicePayments.reduce((sum,ref)=>sum+ref.paid,0)))throw Error('請勾選進貨單，並填寫每張本次付款金額');
 const miscItems=kind==='out'&&category==='misc'?selectedBankMiscItems(date,id):[];if(category==='misc'&&(kind!=='out'||!miscItems.length))throw Error('請勾選要支付的雜支');if(miscItems.length&&amount!==miscItems.reduce((total,item)=>total+item.amount,0))throw Error('雜支金額已變動，請重新勾選');
 const fixedItems=kind==='out'&&['fixed','salary'].includes(category)?selectedBankFixedItems(date,id,category):[];if(['fixed','salary'].includes(category)&&(!fixedItems.length||amount!==fixedItems.reduce((sum,item)=>sum+item.amount,0)))throw Error('請勾選要支付的固定支出');
 const entries=bankEntries(),index=entries.findIndex(e=>e.id===id),entry={id,date,kind,category,amount,fee,memo,...(vendor?{vendor}:{}),...(miscItems.length?{miscItems,paymentSource:miscCashSource()||'bank'}:{}),...(invoicePayments.length?{invoicePayments}:{}),...(fixedItems.length?{fixedItems,paymentSource:miscCashSource()||'bank'}:{})};if(index<0)entries.push(entry);else entries[index]=entry;validateBankVendorPayments(entries);validateBankMiscPayments(entries);validateBankVendorInvoices(entries);validateBankFixedPayments(entries);
 document.getElementById('bankMonth').value=date.slice(0,7);bankCommit(bankConfig(),entries);resetBankForm();showSaveToast(index<0?'銀行紀錄已新增':'金額已修正');
 }catch(e){showSaveToast(e.message);}}
function editBankEntry(id){if(bankEntries().some(e=>e.id===id&&(e.automatic||e.paymentRefs?.length))){showSaveToast('支付金額請在每日記帳修改；入帳日期可取消入帳後重新確認');return;}const e=bankEntries().find(e=>e.id===id);if(!e||e.deleted)return;switchTab('daily');const input=document.getElementById('logDate');if(input.value!==e.date){input.value=e.date;changeDailyDate();}document.getElementById('bankEditId').value=e.id;document.getElementById('bankDate').value=e.date;document.getElementById('bankKind').value=e.kind;bankKindChanged(false);document.getElementById('bankCategory').value=e.category;bankCategoryChanged();document.getElementById('bankVendor').value=e.vendor||'';bankVendorSelected=new Map((e.invoicePayments||[]).map(ref=>[ref.id,ref.paid]));renderBankVendorInvoices();bankMiscSelected=new Set((e.miscItems||[]).map(item=>item.id));bankFixedSelected=new Set((e.fixedItems||[]).map(item=>item.id));renderBankMiscChoices();renderBankFixedChoices();document.getElementById('bankAdjustMode').value='delta';document.getElementById('bankAmount').value=e.amount;document.getElementById('bankFee').value=e.fee;document.getElementById('bankHasFee').checked=e.fee>0;document.getElementById('bankMemo').value=e.memo;document.getElementById('miscPaymentSource').value=e.paymentSource||'bank';toggleBankFee();document.getElementById('bankSaveBtn').textContent='儲存修改';document.getElementById('bankCancelBtn').style.display='flex';document.getElementById('bankEntryForm').open=true;document.getElementById('bankEntryForm').scrollIntoView({behavior:'smooth',block:'start'});}
function deleteBankEntry(id){if(bankEntries().some(e=>e.id===id&&e.automatic)){showSaveToast('請在每日記帳刪除對應的支付金額');return;}const entries=bankEntries().map(e=>e.id===id?{...e,deleted:true}:e);bankCommit(bankConfig(),entries);if(document.getElementById('bankEditId').value===id)resetBankForm();showSaveToast('已刪除，可按復原');}
function renderBank(){
 const c=bankConfig();if(!document.getElementById('bankMonth').value)document.getElementById('bankMonth').value=currentMonthValue();const summary=bankSummary(document.getElementById('bankMonth').value);
 for(const [id,value] of Object.entries({bankName:c.name,bankOpening:c.opening,bankInFee:c.inFee,bankOutFee:c.outFee}))document.getElementById(id).value=value||0;
 document.getElementById('bankStats').innerHTML=[['期初餘額',summary.opening],['實收入帳',summary.rows.filter(e=>e.kind==='in').reduce((sum,e)=>sum+bankDelta(e),0)],['銀行出帳',summary.outgoing],['全部付款出帳（含費）',summary.outgoing+summary.cashPayments+summary.rows.filter(e=>e.kind==='out'&&e.paymentSource!=='till'&&e.paymentSource!=='external').reduce((sum,e)=>sum+e.fee,0)],['手續費',summary.fees],['餘額修正',summary.adjustment],['月底餘額',summary.balance],['進貨支出',summary.purchases],['出貨收入',summary.sales],['廠商付款',summary.vendorPayments],['現金歸還／付款',summary.cashPayments]].map(([label,value])=>`<div class="stat-card">${label}<br><b>${money(value)}</b></div>`).join('');
 renderBankRows('bankRows',summary.rows);
 renderDailyBank();
 document.getElementById('bankUndoBtn').disabled=!get('bankUndo').length;
 if(!document.getElementById('bankDate').value)resetBankForm();
}

function bankRowHtml(e){return `<div class="feature-box"><div class="list-row"><b>${escapeHtml(e.date)} · ${e.kind==='adjust'?'餘額修正':e.vendor?'廠商付款：'+escapeHtml(e.vendor):e.category==='misc'?'雜支付款':e.category==='fixed'?'固定支出付款':e.category==='salary'?'薪資付款':e.category==='purchase'?'進貨支出':e.category==='sale'?'出貨收入':e.paymentRefs?.length?'支付實收入帳':e.kind==='in'?'入帳':'出帳'}</b><b>${e.paymentSource==='till'||e.paymentSource==='external'?'現金 '+money(e.amount):(e.delta>=0?'+':'')+money(e.delta)}</b></div><div class="report-note">${e.paymentSource==='till'?'現金（扣今日營業額）':e.paymentSource==='external'?'另外拿現金':'銀行交易'} ${money(e.amount)} · 手續費 ${money(e.fee)} · 餘額 ${money(e.balance)}${e.invoicePayments?.length?' · '+e.invoicePayments.map(ref=>escapeHtml(ref.date)+' '+escapeHtml(ref.label)+' 付'+money(ref.paid)).join('、'):''}${e.miscItems?.length?' · '+e.miscItems.map(item=>escapeHtml(item.name)).join('、'):''}${e.fixedItems?.length?' · '+e.fixedItems.map(item=>escapeHtml(item.month)+' '+escapeHtml(item.name)).join('、'):''}${e.memo?' · '+escapeHtml(e.memo):''}</div>${e.paymentRefs?.length?`<div class="report-note">${e.paymentRefs.map(ref=>escapeHtml(ref.date)+' '+escapeHtml(ref.name)).join('、')}</div><button class="btn btn-info" data-bank-delete="${escapeHtml(e.id)}">取消入帳</button>`:`<div class="recon-toolbar"><button class="btn btn-primary" data-bank-edit="${escapeHtml(e.id)}">修改</button><button class="btn btn-danger" data-bank-delete="${escapeHtml(e.id)}">刪除</button></div>`}</div>`;}
function renderBankRows(id,rows){const box=document.getElementById(id);box.innerHTML=rows.map(bankRowHtml).join('')||'<div class="report-note">沒有銀行紀錄</div>';box.querySelectorAll('[data-bank-edit]').forEach(b=>b.onclick=()=>editBankEntry(b.dataset.bankEdit));box.querySelectorAll('[data-bank-delete]').forEach(b=>b.onclick=()=>deleteBankEntry(b.dataset.bankDelete));}
function renderDailyBank(syncDate=false){applyBankFeatureVisibility();const date=document.getElementById('logDate').value;if(syncDate&&bankFormDate!==date){resetBankForm();document.getElementById('paymentDepositDate').value=date;paymentDepositSelected=new Set();}document.getElementById('dailyBankBalance').textContent=money(bankBalanceAsOf(date));const rows=bankSummary(date.slice(0,7)).rows.filter(e=>e.date===date);renderBankRows('dailyBankRows',rows);previewBankVendor();renderBankMiscChoices();renderBankFixedChoices();renderBankVendorInvoices();renderOutstandingBills();renderPaymentDeposits();}

function bankMiscPaid(id,excludeId='',entries=bankEntries()){
 return !!id&&entries.some(e=>!e.deleted&&e.id!==excludeId&&e.kind==='out'&&(e.miscItems||[]).some(item=>item.id===id));
}
function bankMiscCandidates(date,excludeId=''){
 const rows=[];
 for(const key of Object.keys(localStorage).filter(key=>key.startsWith(KEY+'d_')).sort()){
  const day=key.slice((KEY+'d_').length);if(!bankValidDate(day)||day>date)continue;
  const d=JSON.parse(localStorage.getItem(key));let changed=false;
  (d?.misc||[]).forEach((item,index)=>{
   if(!item.id){item.id='misc_'+day+'_'+index;changed=true;}
   if(miscNeedsPayment(item)&&!bankMiscPaid(item.id,excludeId))rows.push({id:item.id,date:day,name:item.name,amount:bankInteger(Math.round(num(item.amount))),payer:item.payer||'',settled:!!item.settled});
  });if(changed)set('d_'+day,d);
 }
 return rows;
}
function selectedBankMiscItems(date,excludeId=''){
 const rows=bankMiscCandidates(date,excludeId),selected=rows.filter(item=>bankMiscSelected.has(item.id));
 if(selected.length!==bankMiscSelected.size)throw Error('所選雜支已付款或已變更，請重新選擇');return selected;
}
function renderBankMiscChoices(){
 const linked=document.getElementById('bankKind').value==='out'&&document.getElementById('bankCategory').value==='misc';
 document.getElementById('bankMiscGroup').style.display=linked?'block':'none';document.getElementById('bankAmount').readOnly=linked;
 if(!linked)return;
 const rows=bankMiscCandidates(document.getElementById('bankDate').value,document.getElementById('bankEditId').value);
 const available=new Set(rows.map(item=>item.id));bankMiscSelected=new Set([...bankMiscSelected].filter(id=>available.has(id)));
 const box=document.getElementById('bankMiscChoices');box.innerHTML=rows.map(item=>`<label class="check-row"><input type="checkbox" class="bank-misc-check" value="${escapeHtml(item.id)}" ${bankMiscSelected.has(item.id)?'checked':''}>${escapeHtml(item.date)} ${escapeHtml(item.name)}${item.payer?' / 代墊：'+escapeHtml(item.payer):''}${item.settled?'（帳務已結算，未記出帳）':''} · ${money(item.amount)}</label>`).join('')||'<div class="report-note">所有雜支皆已記錄出帳。</div>';
 box.querySelectorAll('.bank-misc-check').forEach(input=>input.onchange=()=>{input.checked?bankMiscSelected.add(input.value):bankMiscSelected.delete(input.value);updateBankMiscAmount(rows);});updateBankMiscAmount(rows);
}
function updateBankMiscAmount(rows){document.getElementById('bankAmount').value=rows.filter(item=>bankMiscSelected.has(item.id)).reduce((sum,item)=>sum+item.amount,0);previewBankDelta();}
function validateBankMiscPayments(entries){
 const used=new Set();for(const e of entries){if(e.deleted||!e.miscItems?.length)continue;
  if(e.kind!=='out'||e.category!=='misc')throw Error('雜支付款類別不正確');let total=0;
  for(const ref of e.miscItems){const item=get('d_'+ref.date).misc?.find(item=>item.id===ref.id);
   if(used.has(ref.id)||!item||!miscNeedsPayment(item)||bankInteger(Math.round(num(item.amount)))!==ref.amount||ref.date>e.date)throw Error('雜支已付款或已變更，請重新選擇');used.add(ref.id);total+=ref.amount;
  }if(total!==e.amount)throw Error('雜支付款合計不符');
 }
}

function outstandingBills(date){
 const vendors=get('vendors').map(v=>({name:v.name,amount:vendorBalance(v.name,date).unpaid})).filter(v=>v.amount>0);
 const misc=bankMiscCandidates(date),fixed=bankFixedCandidates(date,'',bankEntries(),'fixed'),salary=bankFixedCandidates(date,'',bankEntries(),'salary');
 return {vendors,misc,fixed,salary,total:salary.reduce((sum,item)=>sum+item.amount,0)+fixed.reduce((sum,item)=>sum+item.amount,0)+vendors.reduce((sum,v)=>sum+v.amount,0)+misc.reduce((sum,item)=>sum+item.amount,0)};
}
function renderOutstandingBills(){
 const box=document.getElementById('outstandingRows');if(!box)return;
 const date=document.getElementById('logDate').value,bills=outstandingBills(date);
 document.getElementById('outstandingTotal').textContent=money(bills.total);
 box.innerHTML=bills.vendors.map(v=>`<div class="list-row"><span><b>${escapeHtml(v.name)}</b><br><small>廠商未結清（含前月）</small></span><b>${money(v.amount)}</b><button class="btn btn-primary" data-pay-vendor="${escapeHtml(v.name)}">付款</button></div>`).join('')+(bills.misc.length?`<div class="list-row"><span><b>雜支／代墊出帳</b><br><small>${bills.misc.length} 筆 · 尚未記錄出帳</small></span><b>${money(bills.misc.reduce((sum,item)=>sum+item.amount,0))}</b><button class="btn btn-primary" id="payOutstandingMisc">勾選付款</button></div><details><summary>查看未支付雜支</summary>${bills.misc.map(item=>`<div class="list-row"><span>${escapeHtml(item.date)} ${escapeHtml(item.name)}${item.payer?' / '+escapeHtml(item.payer):''}</span><b>${money(item.amount)}</b></div>`).join('')}</details>`:'')+(bills.fixed.length?`<div class="list-row"><span><b>固定支出</b><br><small>租金、水電等 · ${bills.fixed.length} 筆待付</small></span><b>${money(bills.fixed.reduce((sum,item)=>sum+item.amount,0))}</b><button class="btn btn-primary" id="payOutstandingFixed">勾選付款</button></div>`:'')+(bills.salary.length?`<div class="list-row"><span><b>薪資</b><br><small>${bills.salary.length} 筆待付</small></span><b>${money(bills.salary.reduce((sum,item)=>sum+item.amount,0))}</b><button class="btn btn-primary" id="payOutstandingSalary">勾選付款</button></div>`:'')||'<div class="report-note">目前沒有未結清的帳。</div>';
 box.querySelectorAll('[data-pay-vendor]').forEach(button=>button.onclick=()=>beginOutstandingPayment('vendor',button.dataset.payVendor));
 const salaryButton=document.getElementById('payOutstandingSalary');if(salaryButton)salaryButton.onclick=()=>beginOutstandingPayment('salary');
 const fixedButton=document.getElementById('payOutstandingFixed');if(fixedButton)fixedButton.onclick=()=>beginOutstandingPayment('fixed');
 const miscButton=document.getElementById('payOutstandingMisc');if(miscButton)miscButton.onclick=()=>beginOutstandingPayment('misc');
}
function beginOutstandingPayment(category,name=''){
 if(!bankFeatureEnabled()){showSaveToast('請先在設定開啟銀行出入帳，才能記錄銀行付款');return;}
 clearTimeout(scheduleDailyAutosave.timer);if(saveDaily(true)===false)return;resetBankForm();
 document.getElementById('bankKind').value='out';bankKindChanged();document.getElementById('bankCategory').value=category;bankCategoryChanged();
 if(category==='vendor'){document.getElementById('bankVendor').value=name;fillBankVendorDebt();}
 const form=document.getElementById('bankEntryForm');form.open=true;form.scrollIntoView({behavior:'smooth',block:'start'});
}
function fillBankVendorDebt(){const name=document.getElementById('bankVendor').value;if(!name)return;const date=document.getElementById('bankDate').value,id=document.getElementById('bankEditId').value;if(bankVendorSelectionMode){bankVendorSelected=new Map(bankVendorInvoiceCandidates(name,date,id).map(ref=>[ref.id,ref.remaining]));renderBankVendorInvoices();}else{document.getElementById('bankAmount').value=Math.round(vendorBalance(name,date,id).unpaid);previewBankDelta();}}

function bankVendorInvoiceCandidates(name,date,excludeId='',entries=bankEntries()){
 const last=get('vendorSettlements').filter(e=>e.name===name&&e.date<=date).map(e=>e.date).sort().at(-1)||'',rows=[];
 for(const storageKey of Object.keys(localStorage).filter(key=>key.startsWith(KEY+'d_')).sort()){
  const day=storageKey.slice((KEY+'d_').length);if(day<=last||day>date)continue;const d=get('d_'+day);if(vendorRule(d,name).cycle==='daily')continue;
  for(const [key,value] of Object.entries(d.vs||{}))for(const [index,raw] of (Array.isArray(value)?value:[value]).entries()){
   const invoice=getVendorEntry(key,raw,get('vendors'));if(invoice?.name!==name||invoice.amount<=0)continue;
   const total=Math.round(invoice.amount),id=d.vendorInvoiceIds?.[key]?.[index]||JSON.stringify([day,key,index]);rows.push({id,date:day,key,index,total,remaining:total,label:key===name?'第 '+(index+1)+' 張':key.slice(name.length+1,key.lastIndexOf('_'))});
  }
 }
 let legacy=0;for(const e of entries){if(e.deleted||e.id===excludeId||e.vendor!==name||e.date<=last||e.date>date)continue;
  if(e.invoicePayments?.length){for(const ref of e.invoicePayments){const row=rows.find(row=>row.id===ref.id);if(row)row.remaining-=ref.paid;}}
  else legacy+=num(e.amount);
 }
 for(const row of rows){const paid=Math.min(Math.max(0,row.remaining),legacy);row.remaining-=paid;legacy-=paid;}
 return rows.filter(row=>row.remaining>0);
}
function selectedVendorInvoices(name,date,id){
 const rows=bankVendorInvoiceCandidates(name,date,id),refs=[];
 for(const [key,value] of bankVendorSelected){const row=rows.find(row=>row.id===key),paid=bankInteger(value);if(!row||paid<=0||paid>row.remaining)throw Error('本次付款超過所選進貨單未結清金額');refs.push({...row,paid});}
 return refs;
}
function renderBankVendorInvoices(){
 const linked=document.getElementById('bankKind').value==='out'&&document.getElementById('bankCategory').value==='vendor',box=document.getElementById('bankVendorInvoices');if(!box)return;
 if(!linked){bankVendorSelectionMode=false;return;}
 const id=document.getElementById('bankEditId').value,editing=bankEntries().find(e=>e.id===id);
 bankVendorSelectionMode=!(editing?.vendor&&!editing.invoicePayments?.length);
 if(!bankVendorSelectionMode){box.innerHTML='<div class="report-note">這是舊版整筆付款，可直接修改總額。</div>';return;}
 const name=document.getElementById('bankVendor').value,rows=bankVendorInvoiceCandidates(name,document.getElementById('bankDate').value,id);
 box.innerHTML=rows.map(row=>`<div class="invoice-pay-row"><label class="check-row"><input type="checkbox" data-invoice-select="${escapeHtml(row.id)}" ${bankVendorSelected.has(row.id)?'checked':''}><span>${escapeHtml(row.date)} ${escapeHtml(row.label)}<br><small>未結清 ${money(row.remaining)}</small></span></label><div class="form-group"><label>本次付多少</label><input type="number" min="1" max="${row.remaining}" step="1" data-invoice-amount="${escapeHtml(row.id)}" value="${bankVendorSelected.get(row.id)??row.remaining}" ${bankVendorSelected.has(row.id)?'':'disabled'}></div></div>`).join('')||'<div class="report-note">請選擇有未結清進貨單的廠商。</div>';
 box.querySelectorAll('[data-invoice-select]').forEach(input=>input.onchange=()=>{const row=rows.find(row=>row.id===input.dataset.invoiceSelect);input.checked?bankVendorSelected.set(row.id,row.remaining):bankVendorSelected.delete(row.id);renderBankVendorInvoices();});
 box.querySelectorAll('[data-invoice-amount]').forEach(input=>input.oninput=()=>{bankVendorSelected.set(input.dataset.invoiceAmount,num(input.value));updateVendorInvoiceAmount();});updateVendorInvoiceAmount();
}
function updateVendorInvoiceAmount(){document.getElementById('bankAmount').readOnly=true;document.getElementById('bankAmount').value=[...bankVendorSelected.values()].reduce((sum,value)=>sum+num(value),0);previewBankDelta();}
function validateBankVendorInvoiceSources(overrides={},entries=bankEntries()){
 for(const e of entries){if(e.deleted)continue;for(const ref of e.invoicePayments||[]){const d=overrides[ref.date]||get('d_'+ref.date),raw=d.vs?.[ref.key],values=Array.isArray(raw)?raw:raw===undefined?[]:[raw];
 const ids=values.map((_,index)=>d.vendorInvoiceIds?.[ref.key]?.[index]||JSON.stringify([ref.date,ref.key,index])),index=ids.indexOf(ref.id),value=values[index];
 const invoice=value===undefined?null:getVendorEntry(ref.key,value,get('vendors'));
 if(!invoice||invoice.name!==e.vendor||Math.round(invoice.amount)!==ref.total)throw Error('進貨單已有銀行付款，請先取消該筆付款再修改或刪除進貨單');
 }}
}
function validateBankVendorInvoices(entries){
 validateBankVendorInvoiceSources({},entries);
 for(const e of entries){if(e.deleted||!e.invoicePayments?.length)continue;const rows=bankVendorInvoiceCandidates(e.vendor,e.date,e.id,entries),used=new Set();let total=0;
 for(const ref of e.invoicePayments){const row=rows.find(row=>row.id===ref.id);if(used.has(ref.id)||!row||!Number.isSafeInteger(ref.paid)||ref.paid<=0||ref.paid>row.remaining)throw Error('所選進貨單已付款或付款超過未結清金額');used.add(ref.id);total+=ref.paid;}
 if(total!==e.amount)throw Error('進貨單付款合計不符');
 }
}

function miscNeedsPayment(item){return num(item.amount)>0;}
function miscCashSource(){const source=document.getElementById('miscPaymentSource')?.value;return document.getElementById('bankKind').value==='out'&&['misc','fixed','salary'].includes(document.getElementById('bankCategory').value)&&['till','external'].includes(source)?source:'';}
function miscTillPaid(date,entries=bankEntries()){return entries.filter(e=>!e.deleted&&e.date===date&&e.kind==='out'&&['misc','fixed','salary'].includes(e.category)&&e.paymentSource==='till').reduce((sum,e)=>sum+num(e.amount),0);}

function bankFixedBills(overrides={}){
 const months=new Set(Object.keys(localStorage).filter(key=>key.startsWith(KEY+'m_')).map(key=>key.slice((KEY+'m_').length)).concat(Object.keys(overrides)));
 return [...months].sort().filter(month=>/^\d{4}-\d{2}$/.test(month)).flatMap(month=>{
  const m=overrides[month]||getMonthlyData(month);
  const fixed=getFixedExpenseRows(m,cfg()).map(row=>({id:month+'_'+row.id,month,date:month+'-01',name:row.label,category:'fixed',amount:Math.round(num(row.amount))}));
  const salary=get('staff').map(staff=>({id:month+'_salary_'+staff.n,month,date:month+'-01',name:staff.n+' 薪資',category:'salary',amount:Math.round(num(m.staff?.[staff.n])*num(staff.r)*(1+num(m.bonus?.[staff.n])/100))}));
  return [...fixed,...salary].filter(row=>row.amount>0);
 });
}
function bankFixedCandidates(date,excludeId='',entries=bankEntries(),category='fixed'){
 return bankFixedBills().filter(row=>row.category===category&&row.month<=date.slice(0,7)).map(row=>({...row,amount:row.amount-entries.filter(e=>!e.deleted&&e.id!==excludeId).reduce((sum,e)=>sum+(e.fixedItems||[]).filter(ref=>ref.id===row.id).reduce((n,ref)=>n+ref.amount,0),0)})).filter(row=>row.amount>0);
}
function selectedBankFixedItems(date,excludeId='',category='fixed'){
 const rows=bankFixedCandidates(date,excludeId,bankEntries(),category).filter(row=>bankFixedSelected.has(row.id));if(rows.length!==bankFixedSelected.size)throw Error('固定支出已付款或已變更，請重新選擇');return rows;
}
function renderBankFixedChoices(){
 const linked=document.getElementById('bankKind').value==='out'&&['fixed','salary'].includes(document.getElementById('bankCategory').value),misc=document.getElementById('bankKind').value==='out'&&document.getElementById('bankCategory').value==='misc';
 document.getElementById('bankFixedGroup').style.display=linked?'block':'none';document.getElementById('paymentSourceGroup').style.display=linked||misc?'block':'none';document.getElementById('bankAmount').readOnly=linked||misc;if(!linked)return;
 const category=document.getElementById('bankCategory').value;document.getElementById('bankFixedLabel').textContent=category==='salary'?'選擇薪資':'選擇固定支出';document.getElementById('bankFixedHint').textContent=category==='salary'?'先在每月結算記錄工時、獎金；可勾選多位員工一起付款。':'先在每月結算記錄租金、水電等金額，再勾選付款。';
 const rows=bankFixedCandidates(document.getElementById('bankDate').value,document.getElementById('bankEditId').value,bankEntries(),category),ids=new Set(rows.map(row=>row.id));bankFixedSelected=new Set([...bankFixedSelected].filter(id=>ids.has(id)));
 const box=document.getElementById('bankFixedChoices');box.innerHTML=rows.map(row=>`<label class="check-row"><input type="checkbox" class="bank-fixed-check" value="${escapeHtml(row.id)}" ${bankFixedSelected.has(row.id)?'checked':''}>${escapeHtml(row.month)} ${escapeHtml(row.name)} · ${money(row.amount)}</label>`).join('')||'<div class="report-note">沒有待付款項；請先在每月結算輸入金額。</div>';
 const update=()=>{document.getElementById('bankAmount').value=rows.filter(row=>bankFixedSelected.has(row.id)).reduce((sum,row)=>sum+row.amount,0);previewBankDelta();};box.querySelectorAll('.bank-fixed-check').forEach(input=>input.onchange=()=>{input.checked?bankFixedSelected.add(input.value):bankFixedSelected.delete(input.value);update();});update();
}
function validateBankFixedPayments(entries,overrides={}){
 const bills=new Map(bankFixedBills(overrides).map(row=>[row.id,row])),paid=new Map();
 for(const e of entries){if(e.deleted||!e.fixedItems?.length)continue;if(e.kind!=='out'||!['fixed','salary'].includes(e.category))throw Error('固定支出付款類別不正確');let total=0;const used=new Set();for(const ref of e.fixedItems){const bill=bills.get(ref.id);if(!bill||bill.category!==e.category||used.has(ref.id)||ref.month>e.date.slice(0,7)||!Number.isSafeInteger(ref.amount)||ref.amount<=0)throw Error('費用或薪資已變更，請先修改或刪除對應付款');used.add(ref.id);paid.set(ref.id,(paid.get(ref.id)||0)+ref.amount);if(paid.get(ref.id)>bill.amount)throw Error('費用金額低於已付款金額，請先修改或刪除對應付款');total+=ref.amount;}if(total!==e.amount)throw Error('固定支出付款合計不符');}
}
