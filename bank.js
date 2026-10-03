function bankFeatureEnabled(){return get('bankFeature').enabled!==false;}
function applyBankFeatureVisibility(){
 const enabled=bankFeatureEnabled();
 for(const id of ['bankEntryForm','dailyBankDetails','bankTabButton']){const el=document.getElementById(id);if(el)el.style.display=enabled?'':'none';}
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
function bankConfig(){const c=get('bankConfig');return Array.isArray(c)?{name:'銀行帳戶',opening:0,inFee:0,outFee:0}:c;}
function bankEntries(){return get('bankEntries');}
function bankInteger(value){const n=Number(value);if(!Number.isFinite(n)||!Number.isSafeInteger(n))throw Error('金額請輸入整數元');return n;}
function bankValidDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
function bankDelta(entry){return entry.kind==='adjust'?entry.amount:entry.kind==='in'?entry.amount-entry.fee:-entry.amount-entry.fee;}
function bankSummary(month,entries=bankEntries(),c=bankConfig()){
 let opening=c.opening||0,income=0,outgoing=0,fees=0,adjustment=0,purchases=0,sales=0,vendorPayments=0;
 const rows=[];let running=opening;
 for(const e of [...entries].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))){
  if(e.deleted)continue;const delta=bankDelta(e),m=e.date.slice(0,7);if(m<month)opening+=delta;
  if(m<=month)running+=delta;
  if(m!==month)continue;
  if(e.kind==='in')income+=e.amount;else if(e.kind==='out')outgoing+=e.amount;else adjustment+=e.amount;
  fees+=e.fee;if(e.category==='purchase')purchases+=e.amount;if(e.category==='sale')sales+=e.amount;if(e.vendor)vendorPayments+=e.amount;
  rows.push({...e,delta,balance:running});
 }
 return {opening,income,outgoing,fees,adjustment,purchases,sales,vendorPayments,balance:opening+income-outgoing-fees+adjustment,rows};
}
function bankCommit(config,entries){
 const before={config:bankConfig(),entries:bankEntries()},after={config,entries};const history=get('bankUndo');
 history.push({before,after});set('bankUndo',history.slice(-20));set('bankConfig',config);set('bankEntries',entries);renderBank();syncBankVendorViews();
}
function bankUndo(){const history=get('bankUndo');if(!history.length)return showSaveToast('沒有可復原的銀行修改');const last=history[history.length-1];if(JSON.stringify({config:bankConfig(),entries:bankEntries()})!==JSON.stringify(last.after))return showSaveToast('銀行資料已變動，無法復原');history.pop();set('bankUndo',history);set('bankConfig',last.before.config);set('bankEntries',last.before.entries);resetBankForm();renderBank();syncBankVendorViews();showSaveToast('已復原銀行修改');}
function saveBankConfig(){try{const name=document.getElementById('bankName').value.trim()||'銀行帳戶',opening=bankInteger(document.getElementById('bankOpening').value),inFee=bankInteger(document.getElementById('bankInFee').value),outFee=bankInteger(document.getElementById('bankOutFee').value);if(inFee<0||outFee<0)throw Error('手續費不能小於 0');bankCommit({name,opening,inFee,outFee},bankEntries());resetBankForm();showSaveToast('銀行設定已儲存');}catch(e){showSaveToast(e.message);}}
function bankKindChanged(useDefault=true){
 const kind=document.getElementById('bankKind').value,c=bankConfig(),adjust=kind==='adjust',fee=kind==='in'?c.inFee:c.outFee;
 document.getElementById('bankFeeToggle').style.display=adjust?'none':'flex';document.getElementById('bankCategoryGroup').style.display=adjust?'none':'block';document.getElementById('bankAdjustModeGroup').style.display=adjust?'block':'none';
 document.getElementById('bankMemoLabel').textContent=adjust?'調整原因（必填）':'備註';document.getElementById('bankMemo').required=adjust;
 document.getElementById('bankCategory').innerHTML=adjust?'<option value="general">餘額修正</option>':kind==='in'?'<option value="general">一般入帳</option><option value="sale">出貨收入</option>':'<option value="general">一般出帳</option><option value="vendor">支付廠商欠款</option><option value="purchase">進貨支出</option>';
 if(useDefault){document.getElementById('bankHasFee').checked=!adjust&&fee>0;document.getElementById('bankFee').value=fee||0;document.getElementById('bankAdjustMode').value='target';}
 bankCategoryChanged();toggleBankFee();
}
function bankBalanceAsOf(date,excludeId='',entries=bankEntries()){return num(bankConfig().opening)+entries.filter(e=>!e.deleted&&e.id!==excludeId&&e.date<=date).reduce((sum,e)=>sum+bankDelta(e),0);}
function bankCategoryChanged(){const linked=document.getElementById('bankKind').value==='out'&&document.getElementById('bankCategory').value==='vendor';document.getElementById('bankVendorGroup').style.display=linked?'block':'none';renderBankVendorOptions();previewBankVendor();}
function renderBankVendorOptions(){const input=document.getElementById('bankVendor'),selected=input.value;input.innerHTML='<option value="">選擇廠商</option>'+get('vendors').map(v=>`<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)}</option>`).join('');input.value=selected;}
function previewBankVendor(){const name=document.getElementById('bankVendor').value,date=document.getElementById('bankDate').value||document.getElementById('logDate').value,id=document.getElementById('bankEditId').value,linked=document.getElementById('bankKind').value==='out'&&document.getElementById('bankCategory').value==='vendor',amount=num(document.getElementById('bankAmount').value);const debt=linked&&name?vendorBalance(name,date,id).unpaid:0;document.getElementById('bankVendorDebt').textContent=linked&&name?`未結清 ${money(debt)} · 付款後剩餘 ${money(Math.max(0,debt-amount))}`:'';}
function validateBankVendorPayments(entries){
 for(const e of entries){if(e.deleted||!e.vendor)continue;
  const last=get('vendorSettlements').filter(x=>x.name===e.vendor&&x.date<=e.date).map(x=>x.date).sort().at(-1)||'';
  if(last===e.date)continue;
  if(bankVendorPaid(e.vendor,last,e.date,entries)>vendorPeriodAmount(e.vendor,last,e.date)+0.000001)throw Error('付款超過廠商未結清金額，請確認金額及後續付款');
 }
}
function syncBankVendorViews(){updateVendorBalances();calcDaily(true);renderDailyBank();if(document.getElementById('reconMonth').value)renderRecon();if(document.getElementById('rMonth').value)genFullReport();}
function toggleBankFee(){const show=document.getElementById('bankKind').value!=='adjust'&&document.getElementById('bankHasFee').checked;document.getElementById('bankFeeGroup').style.display=show?'block':'none';previewBankDelta();}
function bankFormAdjustment(value){return document.getElementById('bankAdjustMode').value==='target'?value-bankBalanceAsOf(document.getElementById('bankDate').value,document.getElementById('bankEditId').value):value;}
function previewBankDelta(){const kind=document.getElementById('bankKind').value,value=num(document.getElementById('bankAmount').value),amount=kind==='adjust'?bankFormAdjustment(value):value,fee=kind!=='adjust'&&document.getElementById('bankHasFee').checked?num(document.getElementById('bankFee').value):0;const delta=bankDelta({kind,amount,fee});document.getElementById('bankAmountLabel').textContent=kind==='adjust'?(document.getElementById('bankAdjustMode').value==='target'?'正確銀行餘額':'修正差額（減少填負數）'):'交易金額';document.getElementById('bankAmount').min=kind==='adjust'?'':'0';document.getElementById('bankImpact').textContent=kind==='in'?`實際入帳 ${money(delta)}`:kind==='out'?`實際扣款 ${money(-delta)}`:`調整差額 ${delta>=0?'+':''}${money(delta)}`;previewBankVendor();}
function resetBankForm(){document.getElementById('bankEditId').value='';document.getElementById('bankDate').value=document.getElementById('logDate').value;document.getElementById('bankKind').value='in';bankFormDate=document.getElementById('logDate').value;document.getElementById('bankAmount').value='';document.getElementById('bankMemo').value='';document.getElementById('bankVendor').value='';document.getElementById('bankSaveBtn').textContent='新增銀行紀錄';document.getElementById('bankCancelBtn').style.display='none';bankKindChanged();}
function saveBankEntry(){try{
 if(!document.getElementById('bankAmount').value.trim())throw Error('請輸入金額');
 const id=document.getElementById('bankEditId').value||'bank_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),date=document.getElementById('bankDate').value,kind=document.getElementById('bankKind').value,inputAmount=bankInteger(document.getElementById('bankAmount').value),amount=kind==='adjust'?bankFormAdjustment(inputAmount):inputAmount,fee=kind!=='adjust'&&document.getElementById('bankHasFee').checked?bankInteger(document.getElementById('bankFee').value):0,category=kind==='adjust'?'general':document.getElementById('bankCategory').value,memo=document.getElementById('bankMemo').value.trim();
 if(kind==='adjust'&&!memo)throw Error('請填寫餘額調整原因');
 if(!bankValidDate(date))throw Error('請選擇有效日期');if(!['in','out','adjust'].includes(kind))throw Error('請選擇入帳或出帳');if((kind!=='adjust'&&amount<=0)||(kind==='adjust'&&amount===0))throw Error('請輸入有效金額');if(fee<0||(kind==='in'&&fee>amount))throw Error('請確認手續費金額');if((category==='sale'&&kind!=='in')||(category==='purchase'&&kind!=='out'))throw Error('請確認進貨／出貨類別');
 clearTimeout(scheduleDailyAutosave.timer);saveDaily(true);
 const vendor=kind==='out'&&category==='vendor'?document.getElementById('bankVendor').value:'';if(vendor&&get('vendorSettlements').some(e=>e.name===vendor&&e.date===date))throw Error('該日已勾選結清，請先取消結清再記錄廠商付款');if(category==='vendor'&&(!vendor||!get('vendors').some(v=>v.name===vendor)))throw Error('請選擇付款廠商');
 const entries=bankEntries(),index=entries.findIndex(e=>e.id===id),entry={id,date,kind,category,amount,fee,memo,...(vendor?{vendor}:{})};if(index<0)entries.push(entry);else entries[index]=entry;validateBankVendorPayments(entries);
 document.getElementById('bankMonth').value=date.slice(0,7);bankCommit(bankConfig(),entries);resetBankForm();showSaveToast(index<0?'銀行紀錄已新增':'金額已修正');
 }catch(e){showSaveToast(e.message);}}
function editBankEntry(id){const e=bankEntries().find(e=>e.id===id);if(!e||e.deleted)return;switchTab('daily');const input=document.getElementById('logDate');if(input.value!==e.date){input.value=e.date;changeDailyDate();}document.getElementById('bankEditId').value=e.id;document.getElementById('bankDate').value=e.date;document.getElementById('bankKind').value=e.kind;bankKindChanged(false);document.getElementById('bankCategory').value=e.category;bankCategoryChanged();document.getElementById('bankVendor').value=e.vendor||'';document.getElementById('bankAdjustMode').value='delta';document.getElementById('bankAmount').value=e.amount;document.getElementById('bankFee').value=e.fee;document.getElementById('bankHasFee').checked=e.fee>0;document.getElementById('bankMemo').value=e.memo;toggleBankFee();document.getElementById('bankSaveBtn').textContent='儲存修改';document.getElementById('bankCancelBtn').style.display='flex';document.getElementById('bankEntryForm').scrollIntoView({behavior:'smooth',block:'start'});}
function deleteBankEntry(id){const entries=bankEntries().map(e=>e.id===id?{...e,deleted:true}:e);bankCommit(bankConfig(),entries);if(document.getElementById('bankEditId').value===id)resetBankForm();showSaveToast('已刪除，可按復原');}
function renderBank(){
 const c=bankConfig();if(!document.getElementById('bankMonth').value)document.getElementById('bankMonth').value=currentMonthValue();const summary=bankSummary(document.getElementById('bankMonth').value);
 for(const [id,value] of Object.entries({bankName:c.name,bankOpening:c.opening,bankInFee:c.inFee,bankOutFee:c.outFee}))document.getElementById(id).value=value||0;
 document.getElementById('bankStats').innerHTML=[['期初餘額',summary.opening],['入帳交易',summary.income],['出帳交易',summary.outgoing],['手續費',summary.fees],['餘額修正',summary.adjustment],['月底餘額',summary.balance],['進貨支出',summary.purchases],['出貨收入',summary.sales],['廠商付款',summary.vendorPayments]].map(([label,value])=>`<div class="stat-card">${label}<br><b>${money(value)}</b></div>`).join('');
 renderBankRows('bankRows',summary.rows);
 renderDailyBank();
 document.getElementById('bankUndoBtn').disabled=!get('bankUndo').length;
 if(!document.getElementById('bankDate').value)resetBankForm();
}

function bankRowHtml(e){return `<div class="feature-box"><div class="list-row"><b>${escapeHtml(e.date)} · ${e.kind==='adjust'?'餘額修正':e.vendor?'廠商付款：'+escapeHtml(e.vendor):e.category==='purchase'?'進貨支出':e.category==='sale'?'出貨收入':e.kind==='in'?'入帳':'出帳'}</b><b>${e.delta>=0?'+':''}${money(e.delta)}</b></div><div class="report-note">交易 ${money(e.amount)} · 手續費 ${money(e.fee)} · 餘額 ${money(e.balance)}${e.memo?' · '+escapeHtml(e.memo):''}</div><div class="recon-toolbar"><button class="btn btn-primary" data-bank-edit="${escapeHtml(e.id)}">修改</button><button class="btn btn-danger" data-bank-delete="${escapeHtml(e.id)}">刪除</button></div></div>`;}
function renderBankRows(id,rows){const box=document.getElementById(id);box.innerHTML=rows.map(bankRowHtml).join('')||'<div class="report-note">沒有銀行紀錄</div>';box.querySelectorAll('[data-bank-edit]').forEach(b=>b.onclick=()=>editBankEntry(b.dataset.bankEdit));box.querySelectorAll('[data-bank-delete]').forEach(b=>b.onclick=()=>deleteBankEntry(b.dataset.bankDelete));}
function renderDailyBank(syncDate=false){applyBankFeatureVisibility();const date=document.getElementById('logDate').value;if(syncDate&&bankFormDate!==date)resetBankForm();document.getElementById('dailyBankBalance').textContent=money(bankBalanceAsOf(date));const rows=bankSummary(date.slice(0,7)).rows.filter(e=>e.date===date);renderBankRows('dailyBankRows',rows);previewBankVendor();}
