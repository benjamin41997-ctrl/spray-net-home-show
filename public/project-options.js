export const VISUALIZER_SURFACES = Object.freeze(['Cabinets','Siding','Fascia','Gutters and downspouts','Windows','Front door','Garage door and frame']);
export function selectedSurfaces(values) {
  if (!Array.isArray(values) || values.length<1 || values.length>VISUALIZER_SURFACES.length
    || values.some(value=>!VISUALIZER_SURFACES.includes(value))) throw new TypeError('Choose at least one surface to visualize.');
  return VISUALIZER_SURFACES.filter(value=>values.includes(value));
}
export function visitorAppointment(booking,minutes=60) {
  const start=Date.parse(booking?.start),end=Date.parse(booking?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end<=start || !Number.isInteger(minutes) || minutes<1 || minutes>240)
    throw new TypeError('A confirmed consultation time is required.');
  return {...booking,end:new Date(Math.min(end,start+minutes*60000)).toISOString()};
}
