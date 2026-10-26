/** Shared NaviPRO/TSD event clock. IndoRallyHub UI reference: Master Clock HH:mm:ss.cc.
 * The site's underlying clock source is NOT verified; use only authenticated NaviPRO time samples.
 * No 60:100 time scaling is applied.
 */
const ALLOWED = new Set(['NAVIPRO_MASTER_CLOCK']);
const finite = n => typeof n === 'number' && Number.isFinite(n);
const whole = n => Number.isSafeInteger(n);
const pad = n => String(n).padStart(2, '0');
export function formatMasterClock(epochMs, timeZone = 'Asia/Makassar') {
  if (!finite(epochMs)) throw new TypeError('Invalid timestamp');
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(epochMs));
  const pick = t => p.find(x => x.type === t)?.value;
  const cs = Math.floor((((epochMs % 1000) + 1000) % 1000) / 10);
  return pick('hour') + ':' + pick('minute') + ':' + pick('second') + '.' + pad(cs);
}
export class RallyMasterClock {
  constructor({ monoNow = () => performance.now(), wallNow = () => Date.now(),
    timeZone = 'Asia/Makassar', staleAfterMs = 30000, maxRttMs = 2000,
    maxUncertaintyMs = 1000 } = {}) {
    Object.assign(this, { monoNow, wallNow, timeZone, staleAfterMs, maxRttMs, maxUncertaintyMs });
    this.anchor = null;
  }
  sync({ serverEpochMs, clientStartMonoMs, clientEndMonoMs, sourceId,
    sourceUncertaintyMs = 0, authenticated = false, sampleId = null }) {
    if (!ALLOWED.has(sourceId) || authenticated !== true) throw new Error('UNTRUSTED_TIME_SOURCE');
    if (![serverEpochMs,clientStartMonoMs,clientEndMonoMs,sourceUncertaintyMs].every(finite) ||
      clientEndMonoMs < clientStartMonoMs || sourceUncertaintyMs < 0) throw new Error('INVALID_TIME_SAMPLE');
    const rtt = clientEndMonoMs - clientStartMonoMs;
    const error = rtt / 2 + sourceUncertaintyMs;
    if (rtt > this.maxRttMs || error > this.maxUncertaintyMs) throw new Error('CLOCK_SAMPLE_LOW_QUALITY');
    this.anchor = { serverEpochMs, midMono: (clientStartMonoMs + clientEndMonoMs)/2,
      endMono: clientEndMonoMs, rtt, error, sourceId, sampleId };
    return this.snapshot();
  }
  snapshot() {
    const m = this.monoNow();
    if (!this.anchor) {
      const epochMs = this.wallNow();
      return {epochMs, display:formatMasterClock(epochMs,this.timeZone),
        zone:this.timeZone,quality:'UNSYNCED',authoritative:false,
        sourceId:'DEVICE_CLOCK_UNVERIFIED',uncertaintyMs:null,ageMs:null};
    }
    const ageMs = Math.max(0, m-this.anchor.endMono);
    const epochMs = this.anchor.serverEpochMs+m-this.anchor.midMono;
    const quality = ageMs <= this.staleAfterMs ? 'SYNCED' : 'STALE';
    return {epochMs,display:formatMasterClock(epochMs,this.timeZone),zone:this.timeZone,
      quality,authoritative:quality==='SYNCED',sourceId:this.anchor.sourceId,
      sampleId:this.anchor.sampleId,uncertaintyMs:this.anchor.error,ageMs};
  }
}
export function makeSubSchedule({eventDate,startTime,offsetsMinutes,
  timeZone='Asia/Makassar',durationSource='DERIVED_REVIEW_REQUIRED'}) {
  if (timeZone!=='Asia/Makassar') throw new Error('TIME_ZONE_UNSUPPORTED_BY_FIXTURE');
  if (!/^\d{4}-\d\d-\d\d$/.test(eventDate)|| !/^\d\d:\d\d$/.test(startTime)) throw new Error('INVALID_SCHEDULE_START');
  if (!Array.isArray(offsetsMinutes)||!offsetsMinutes.length) throw new Error('EMPTY_SUB_SCHEDULE');
  let next=Date.parse(eventDate+'T'+startTime+':00+08:00');
  if (!finite(next)) throw new Error('INVALID_SCHEDULE_DATE');
  return offsetsMinutes.map((s,i)=>{
    if (typeof s.id!=='string'||!s.id||!whole(s.minutes)||s.minutes<1) throw new Error('INVALID_SUB_DURATION');
    const startEpochMs=next;next+=s.minutes*60000;
    return Object.freeze({id:s.id,order:i+1,startEpochMs,endEpochMs:next,
      durationMinutes:s.minutes,durationSource:s.durationSource||durationSource});
  });
}
export function scheduledSub(schedule,clockSnapshot) {
  if (!clockSnapshot?.authoritative) return {status:'TIME_SOURCE_HOLD',scheduled:null};
  const s=schedule.find(x=>clockSnapshot.epochMs>=x.startEpochMs&&clockSnapshot.epochMs<x.endEpochMs);
  return s?{status:'SCHEDULED_ONLY',scheduled:s.id}:{status:'OUTSIDE_SCHEDULE',scheduled:null};
}
export function activationDecision({scheduleStatus,boundaryVerified=false,planAcknowledged=false}) {
  if (scheduleStatus.status!=='SCHEDULED_ONLY') return 'HOLD';
  if (!planAcknowledged||!boundaryVerified) return 'BOUNDARY_HOLD';
  return 'ELIGIBLE_FOR_NAVIGATOR_REVIEW';
}
export function cpTargetSecond({subStartEpochMs,subDistanceM,durationMinutes,cpDistanceM,
  cpBindingStatus,distanceAuthority}) {
  if (cpBindingStatus!=='VERIFIED'||distanceAuthority!=='OFFICIAL_RECONCILED')
    return {status:'UNRESOLVED',targetEpochMs:null};
  if (![subStartEpochMs,subDistanceM,durationMinutes,cpDistanceM].every(finite)||
    subDistanceM<=0||!whole(durationMinutes)||durationMinutes<1||cpDistanceM<0||cpDistanceM>subDistanceM)
    throw new Error('INVALID_CP_DISTANCE_OR_TIME');
  const elapsedSeconds=Math.round(cpDistanceM/subDistanceM*durationMinutes*60);
  return {status:'DERIVED_TARGET_SECOND',elapsedSeconds,
    targetEpochMs:subStartEpochMs+elapsedSeconds*1000};
}