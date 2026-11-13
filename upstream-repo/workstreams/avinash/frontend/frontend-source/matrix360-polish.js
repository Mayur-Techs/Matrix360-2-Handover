/* Progressive presentation enhancements; existing forms and workflows remain authoritative. */
(() => {
 'use strict';
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const sidebar=document.querySelector('body.m360-matched-crm .side');
 if(sidebar){const navigation=document.createElement('nav');navigation.id='m360-polish-navigation';navigation.setAttribute('aria-label','Workspace sections');for(const source of document.querySelectorAll('#m360-mp-topbar [data-m360-goto]')){const button=document.createElement('button');button.type='button';button.textContent=source.textContent;button.dataset.destination=source.dataset.m360Goto;button.addEventListener('click',()=>{if(window.Matrix360Router)window.Matrix360Router.navigateToPage(button.dataset.destination);else source.click();});navigation.append(button);}sidebar.querySelector('.brand')?.after(navigation);const update=()=>{const page=new URL(location.href).searchParams.get('page')||'dashboard';for(const button of navigation.children)button.setAttribute('aria-current',button.dataset.destination===page?'page':'false');};document.addEventListener('click',()=>queueMicrotask(update));addEventListener('popstate',update);update();}
 const workspaceNav=document.getElementById('m360-sidebar-mp-nav');
 if(workspaceNav&&!workspaceNav.querySelector('[data-m360-sidebar-page="research"]')){const link=document.createElement('a');link.href='?page=research#market-research';link.className='m360-sidebar-mp-link';link.dataset.m360SidebarPage='research';link.textContent='Market Research';link.addEventListener('click',event=>{if(window.Matrix360Router){event.preventDefault();window.Matrix360Router.navigateToPage('research');}});workspaceNav.append(link);}
 const password=document.getElementById('password');
 if(password){
  const wrap=document.createElement('div');wrap.className='m360-password-field';password.before(wrap);wrap.append(password);
  const toggle=document.createElement('button');toggle.type='button';toggle.className='m360-password-toggle';toggle.textContent='Show';toggle.setAttribute('aria-label','Show password');toggle.setAttribute('aria-controls','password');toggle.setAttribute('aria-pressed','false');
  toggle.addEventListener('click',()=>{const show=password.type==='password';password.type=show?'text':'password';toggle.textContent=show?'Hide':'Show';toggle.setAttribute('aria-label',show?'Hide password':'Show password');toggle.setAttribute('aria-pressed',String(show));});wrap.append(toggle);
  const title=document.getElementById('form-title');if(title)title.textContent='Sign in to your workspace';
  document.getElementById('tab-login')?.addEventListener('click',()=>{if(title)title.textContent='Sign in to your workspace';});
  const tabs=[...document.querySelectorAll('[role=tab]')];
  const syncTabs=()=>tabs.forEach(tab=>{tab.tabIndex=tab.getAttribute('aria-selected')==='true'?0:-1;});
  tabs.forEach(tab=>{const panel=document.getElementById(tab.id==='tab-login'?'signin':'signup');if(panel){tab.setAttribute('aria-controls',panel.id);panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);}tab.addEventListener('click',syncTabs);tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const index=tabs.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus();});});syncTabs();
 }
 // The provider inserts the canonical pricing section after the original nav is created.
 const repairPricing=()=>{if(document.getElementById('m360-new-plans'))document.querySelectorAll('a[href="#m360-pricing-section"]').forEach(link=>link.setAttribute('href','#m360-new-plans'));};repairPricing();
 if(document.querySelector('.hero-art')){
  const observer=new MutationObserver(repairPricing);observer.observe(document.body,{childList:true,subtree:true});
  if('IntersectionObserver' in window){const reveal=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('m360-in-view');reveal.unobserve(entry.target);}}),{threshold:.08});document.querySelectorAll('.pillar,.process-step,.audience-card').forEach(item=>reveal.observe(item));}
  const art=document.querySelector('.hero-art');let scheduled=false;
  const move=()=>{scheduled=false;if(!reduced.matches&&innerWidth>=1024)art.style.setProperty('--m360-parallax',Math.min(14,scrollY*.025)+'px');else art.style.setProperty('--m360-parallax','0px');};
  addEventListener('scroll',()=>{if(!scheduled){scheduled=true;requestAnimationFrame(move);}},{passive:true});reduced.addEventListener('change',move);addEventListener('resize',move);move();
 }
})();
