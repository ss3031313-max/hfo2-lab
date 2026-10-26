/* Reference disclosure layer; original typography is preserved. Analysis rules and saved measurements are unchanged. */
(function(){
 'use strict';
 const style=document.createElement('style');
 style.id='presentation-readability';
 style.textContent=`
.cv-reference{border:1px solid #d7e4e1;border-radius:10px;background:#f5faf9;margin:16px 0;padding:0;color:#314e5a;font-size:12px}
.cv-reference>summary{padding:12px 16px;font-size:12px;font-weight:700;line-height:1.6;color:#176b65;cursor:pointer}.cv-reference[open]>summary{border-bottom:1px solid #dce8e6}.cv-reference-body{padding:5px 16px 15px}.cv-reference p{font-size:12px;margin:10px 0;line-height:1.75}.cv-reference article+article{border-top:1px solid #dce8e6;padding-top:10px;margin-top:12px}.cv-reference h4{font-size:13px;margin:9px 0 4px}.cv-reference a{color:#086f70;text-decoration:underline;text-underline-offset:3px;font-weight:650}.cv-reference .cv-reference-context{background:#eaf3f0;border-radius:8px;padding:10px 12px}.cv-reference .cv-reference-date{font-size:11px;color:#617d81}
.app-page .intake-combined-count .intake-count-detail{font-size:11px;line-height:1.6}.app-page .intake-combined-count .intake-count-jump{font-size:11px}
@media(max-width:600px){.app-page .intake-combined-count .intake-count-detail{font-size:10px}}
@media print{.cv-reference{break-inside:avoid}}
`;
 document.head.appendChild(style);
 const content=`<summary>CV 기준 · 참고 자료</summary><div class="cv-reference-body"><article><h4>Laurell Technologies · 스핀코팅 균일도</h4><p>균일도 허용치를 일률적으로 제시하지 않으며, 재료·도포 방식·환경에 맞춰 공정을 개발해야 한다고 설명합니다.</p><a href="https://www.laurell.com/support/tech-notes.php" target="_blank" rel="noopener noreferrer">Laurell 공식 자료 열기 ↗</a></article><article><h4>FOM Technologies · 상대 표준편차 5% 미만 사례</h4><p>PEDOT:PSS의 슬롯다이 코팅에서 두께의 상대 표준편차 5% 미만을 보고했습니다. 재료와 코팅 방식이 다르므로 HfO₂의 합격 규격으로 그대로 적용할 근거는 아닙니다.</p><a href="https://www.fomtechnologies.com/science-and-learning/insights-blog/film-uniformity-in-pedot-pss-coatings/" target="_blank" rel="noopener noreferrer">FOM 공식 자료 열기 ↗</a></article><p class="cv-reference-context"><strong>프로그램 적용</strong><br>CV = 표본 표준편차 ÷ 평균 두께 × 100. 기본 상한 10%는 초기 선별 설정입니다. 5%는 참고 사례를 바탕으로 제안한 관리 목표이며, HfO₂에서 검증된 합격 규격은 아닙니다. 실제 판정에는 화면에 입력한 상한을 적용합니다.</p><p>측정 위치와 영역을 통일하고 반복 측정·시편 비교로 기준을 검증해야 합니다. CV 5%는 모든 측정값이 평균의 ±5% 안에 있다는 뜻이 아닙니다.</p><p class="cv-reference-date">자료 확인: 2026-10-26 · 요약은 오프라인에서도 표시되며 원문 링크는 인터넷 연결이 필요합니다.</p></div>`;
 function reference(id){const node=document.createElement('details');node.className='cv-reference';node.id=id;node.innerHTML=content;return node;}
 const thickness=document.querySelector('.app-rule-strip');
 if(thickness)thickness.insertAdjacentElement('afterend',reference('thicknessCVReferences'));
 const candidates=document.getElementById('intakeCandidateSummary');
 if(candidates)candidates.insertAdjacentElement('beforebegin',reference('comparisonCVReferences'));
})();
