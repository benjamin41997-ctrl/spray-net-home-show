export const MAX_CUSTOM_PROMPT=1000;
export function customRenderPrompt(value) {
  if(value==null)return '';
  if(typeof value!=='string')throw new TypeError('Please enter your visualization instructions as text.');
  const prompt=value.replace(/\r\n?/g,'\n').trim();
  if(prompt.length>MAX_CUSTOM_PROMPT||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(prompt))
    throw new TypeError('Keep your visualization instructions to 1,000 characters or fewer.');
  return prompt;
}
