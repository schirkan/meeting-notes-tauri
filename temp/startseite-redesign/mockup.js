const byId = (id) => document.getElementById(id);
const models = {
  standard: 'Azure Speech (standard)',
  mai: 'Azure MAI Transcribe (Preview)',
  sapi: 'Windows SAPI (Experimental)',
  web: 'Web Speech API (Experimental)',
};
const meetingModel = byId('meeting-model');
const fileModel = byId('file-model');
const mic = byId('mic');
const speaker = byId('speaker');
const preview = byId('preview-dialog');
const selectedFiles = new Set();
let mode = 'live';

function fillModels(select, live, selected = 'standard') {
  select.replaceChildren(...Object.entries(models)
    .filter(([id]) => live || id !== 'web')
    .map(([id, label]) => new Option(label, id)));
  select.value = selected;
}

function updateMeeting() {
  const live = mode === 'live';
  const model = meetingModel.value;
  const monoOnly = model !== 'standard';
  const defaultMic = live && model === 'web';
  byId('record-workflow').dataset.mode = mode;
  byId('start-live').closest('.live-controls').inert = !live;
  byId('stream').disabled = !live || monoOnly;
  byId('stream').options[0].textContent = defaultMic ? 'Mono (default microphone)' : 'Mono (separate sessions per audio device)';
  if (monoOnly) byId('stream').value = 'mono';
  byId('language').disabled = model === 'mai';
  byId('detect-language').disabled = model !== 'standard' || (live && byId('stream').value === 'stereo');
  if (byId('detect-language').disabled) byId('detect-language').checked = model === 'mai';
  else if (previousModel === 'mai') byId('detect-language').checked = false;
  byId('recognize-speakers').disabled = model !== 'standard';
  if (model !== 'standard') byId('recognize-speakers').checked = false;
  byId('interim').disabled = !live || model === 'sapi';
  if (model === 'sapi') byId('interim').checked = false;
  mic.disabled = defaultMic;
  speaker.disabled = defaultMic;
  if (defaultMic) {
    mic.checked = true;
    speaker.checked = false;
    byId('mic-device').selectedIndex = 0;
  }
  byId('mic-device').disabled = defaultMic || !mic.checked;
  byId('speaker-device').disabled = defaultMic || !speaker.checked;
  previousModel = model;
}

function showPreview(title) {
  byId('preview-title').textContent = title;
  preview.showModal();
}

let previousModel = 'standard';
fillModels(meetingModel, true);
fillModels(fileModel, false);
updateMeeting();
document.querySelectorAll('[name="mode"]').forEach((radio) => radio.addEventListener('change', () => {
  mode = radio.value;
  updateMeeting();
}));
meetingModel.addEventListener('change', updateMeeting);
byId('stream').addEventListener('change', updateMeeting);
for (const [source, other] of [[mic, speaker], [speaker, mic]]) {
  source.addEventListener('change', () => {
    if (!source.checked && !other.checked) other.checked = true;
    updateMeeting();
  });
}
for (const id of ['start-live', 'start-batch']) {
  const button = byId(id);
  button.addEventListener('click', () => showPreview(button.textContent));
}

const transcribe = byId('transcribe');
for (const [source, icon] of [['Microphone', 'mic'], ['Speaker', 'speaker']]) {
  const slot = byId('file-slot').content.firstElementChild.cloneNode(true);
  const input = slot.querySelector('.file-input');
  const path = slot.querySelector('.file-path');
  const choose = slot.querySelector('.choose');
  const remove = slot.querySelector('.remove');
  const details = slot.querySelector('.file-details');
  const time = slot.querySelector('.start-time');
  slot.querySelector('.source-label').textContent = `${source} WAV`;
  slot.querySelector('use').setAttribute('href', `#icon-${icon}`);
  choose.setAttribute('aria-label', `Select file for ${source.toLowerCase()} WAV`);
  path.setAttribute('aria-label', `${source} WAV file path`);
  const removeLabel = `Remove ${source.toLowerCase()} WAV`;
  remove.setAttribute('aria-label', removeLabel);
  remove.title = removeLabel;
  details.querySelector('.field-caption').textContent = `${source} start time`;
  input.setAttribute('aria-label', `${source} WAV`);

  function updateFile(file) {
    remove.hidden = time.disabled = !file;
    path.value = path.title = file?.name ?? '';
    const timestamp = file ? new Date(file.lastModified) : null;
    time.value = timestamp && Number.isFinite(timestamp.getTime())
      ? new Date(timestamp.getTime() - timestamp.getTimezoneOffset() * 60_000).toISOString().slice(0, 19)
      : '';
    if (file) selectedFiles.add(time);
    else selectedFiles.delete(time);
    transcribe.disabled = selectedFiles.size === 0;
    byId('transcribe-hint').hidden = !transcribe.disabled;
  }

  choose.addEventListener('click', () => input.click());
  input.addEventListener('change', () => updateFile(input.files[0]));
  remove.addEventListener('click', () => {
    input.value = '';
    updateFile();
    choose.focus();
  });
  byId('file-slots').append(slot);
}

const fileLanguage = byId('file-language');
const autoLanguage = fileLanguage.options[0];
const fileSpeakers = byId('file-speaker-recognition');
let azureLanguage = fileLanguage.value;
let azureSpeakers = fileSpeakers.checked;
let nativeLanguage = 'en-US';

fileLanguage.addEventListener('change', () => {
  if (fileModel.value === 'sapi') nativeLanguage = fileLanguage.value;
  else azureLanguage = fileLanguage.value;
});
fileSpeakers.addEventListener('change', () => { azureSpeakers = fileSpeakers.checked; });

fileModel.addEventListener('change', () => {
  const native = fileModel.value === 'sapi';
  autoLanguage.disabled = native;
  fileLanguage.value = native ? nativeLanguage : azureLanguage;
  byId('file-language-hint').hidden = !native;
  fileSpeakers.disabled = native;
  fileSpeakers.checked = !native && azureSpeakers;
  byId('check-model').hidden = !native;
});
byId('check-model').addEventListener('click', () => showPreview('Check model availability'));
transcribe.addEventListener('click', () => {
  for (const time of selectedFiles) if (!time.reportValidity()) return;
  showPreview('Transcribe audio files');
});
