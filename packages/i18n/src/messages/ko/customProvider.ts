import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/customProvider";

export const messages = {
  // Form validation. Each message names one field of the custom provider form.
  "customProvider.error.providerIdRequired": "제공자 ID를 입력해 주세요.",
  "customProvider.error.providerIdPattern":
    "영문 소문자, 숫자, 하이픈, 밑줄을 사용하고 영문자 또는 숫자로 시작해야 해요.",
  "customProvider.error.providerIdLength": "제공자 ID는 {max}자 미만으로 입력해 주세요.",
  "customProvider.error.providerIdBuiltIn": "Dengerbot에 이미 {id}라는 제공자가 있어요. 다른 ID를 선택해 주세요.",
  "customProvider.error.providerIdSaved":
    "{id}라는 엔드포인트가 이미 저장되어 있어요. 먼저 제거하거나 다른 ID를 선택해 주세요.",
  "customProvider.error.displayNameRequired": "표시 이름을 입력해 주세요.",
  "customProvider.error.displayNameLength": "표시 이름은 {max}자 미만으로 입력해 주세요.",
  "customProvider.error.apiKeyLength": "API 키는 {max}자 미만으로 입력해 주세요.",
  "customProvider.error.modelsRequired": "모델을 하나 이상 추가해 주세요.",
  "customProvider.error.modelsLimit": "모델은 {max}개까지만 추가할 수 있어요.",
  "customProvider.error.modelIdRequired": "모델 ID를 입력해 주세요.",
  "customProvider.error.modelIdDuplicate": "이 제공자에 {id}이(가) 이미 있어요.",
  "customProvider.error.modelIdInvalid": "이 모델 ID는 사용할 수 없어요. 공백, 따옴표, 기타 구두점을 제거해 주세요.",
  "customProvider.error.headerNameRequired": "헤더 이름을 입력해 주세요.",
  "customProvider.error.headerNameInvalid": "올바른 HTTP 헤더 이름을 사용해 주세요.",
  "customProvider.error.headerDuplicate": "이 제공자에 {name}이(가) 이미 설정되어 있어요.",
  "customProvider.error.headerValueRequired": "헤더 값을 입력해 주세요.",
  "customProvider.error.headersLimit": "헤더는 {max}개까지만 추가할 수 있어요.",
  "customProvider.error.baseUrlRequired": "기본 URL을 입력해 주세요.",
  "customProvider.error.baseUrlLength": "기본 URL은 {max}자 미만으로 입력해 주세요.",
  "customProvider.error.baseUrlInvalid": "{example}처럼 전체 URL을 입력해 주세요.",
  "customProvider.error.baseUrlProtocol": "http:// 또는 https:// URL을 사용해 주세요.",
  "customProvider.error.baseUrlCredential": "자격 증명은 URL이 아닌 헤더에 넣어 주세요.",

  // The note after a save or a removal. It tells the user when OpenCode reads the new list.
  "customProvider.saved.restarted": "저장했어요. Dengerbot이 모델을 불러오는 중이에요.",
  "customProvider.saved.skippedBusy": "저장했어요. OpenCode는 현재 작업이 끝난 후 목록을 읽어요.",
  "customProvider.saved.notRunning": "저장했어요. OpenCode는 다음에 시작할 때 목록을 읽어요.",
  "customProvider.removed.restarted": "제거했어요. Dengerbot이 모델을 불러오는 중이에요.",
  "customProvider.removed.skippedBusy": "제거했어요. OpenCode는 현재 작업이 끝난 후 목록을 읽어요.",
  "customProvider.removed.notRunning": "제거했어요. OpenCode는 다음에 시작할 때 목록을 읽어요.",
  "customProvider.saveFailed": "Dengerbot이 이 엔드포인트를 저장하지 못했어요.",
  "customProvider.removeFailed": "Dengerbot이 {name}을(를) 제거하지 못했어요.",
  "customProvider.saveUnavailable": "이 빌드에서는 엔드포인트를 저장할 수 없어요.",
  "customProvider.removeUnavailable": "이 빌드에서는 엔드포인트를 제거할 수 없어요.",

  // The add dialog.
  "customProvider.form.title": "사용자 지정 제공자 추가",
  "customProvider.form.editTitle": "사용자 지정 제공자 편집",
  "customProvider.form.description": "OpenAI 호환 엔드포인트와 그 엔드포인트가 제공하는 모델을 설명해 주세요.",
  "customProvider.form.heading": "사용자 지정 제공자",
  "customProvider.form.subtitle": "모든 OpenAI 호환 엔드포인트.",
  "customProvider.field.providerId": "제공자 ID",
  "customProvider.field.providerIdHint": "영문 소문자, 숫자, 하이픈, 밑줄.",
  "customProvider.field.displayName": "표시 이름",
  "customProvider.field.displayNamePlaceholder": "내 제공자",
  "customProvider.field.baseUrl": "기본 URL",
  "customProvider.field.apiKey": "API 키",
  "customProvider.field.apiKeyHint": "선택 사항이에요. 헤더로 인증을 관리한다면 비워 두세요.",
  "customProvider.field.apiKeyKeptHint": "키가 저장되어 있어요. 키와 저장된 헤더를 유지하려면 비워 두세요.",
  "customProvider.models": "모델",
  "customProvider.model.id": "모델 {number} ID",
  "customProvider.model.name": "모델 {number} 표시 이름",
  "customProvider.model.namePlaceholder": "표시 이름",
  "customProvider.model.remove": "모델 {number} 제거",
  // The saved endpoints list: its heading, its rows and the delete confirmation.
  "customProvider.list.title": "사용자 정의 엔드포인트",
  "customProvider.list.description": "이 컴퓨터에 추가한 엔드포인트입니다.",
  "customProvider.list.subtitle": "이 컴퓨터에 저장된 OpenAI 호환 엔드포인트",
  "customProvider.list.empty": "엔드포인트가 없습니다. 추가하면 모델을 사용할 수 있습니다.",
  "customProvider.list.label": "저장된 엔드포인트",
  "customProvider.list.apiKeySaved": "API 키 저장됨",
  "customProvider.list.deleteLabel": "{name} 삭제",
  "customProvider.list.editLabel": "{name} 편집",
  "customProvider.list.confirmTitle": "{name} 삭제할까요?",
  "customProvider.list.confirmDescription":
    "엔드포인트와 모델이 이 컴퓨터에서 삭제됩니다. 사용 중인 에이전트는 다른 모델을 선택합니다.",
  "customProvider.model.add": "모델 추가",
  "customProvider.headers": "헤더",
  "customProvider.header.name": "헤더 {number} 이름",
  "customProvider.header.value": "헤더 {number} 값",
  "customProvider.header.valuePlaceholder": "값",
  "customProvider.header.remove": "헤더 {number} 제거",
  "customProvider.header.add": "헤더 추가",
  "customProvider.submit": "제출",

  // Model discovery. OpenBot asks the endpoint for its model list, and the user picks from it.
  "customProvider.discovery.find": "모델 찾기",
  "customProvider.discovery.refresh": "다시 찾기",
  "customProvider.discovery.loading": "{url}에 모델 목록을 요청하는 중이에요.",
  "customProvider.discovery.found": {
    other: "엔드포인트에 모델이 {count}개 있어요. 추가할 모델을 선택하세요.",
  },
  "customProvider.discovery.empty": "엔드포인트에 모델이 없어요. 모델 ID를 직접 추가해 주세요.",
  "customProvider.discovery.label": "엔드포인트에 있는 모델",

  // The first step of the add flow: a preset fills the form that comes next.
  "customProvider.preset.title": "제공자 또는 에이전트 추가",
  "customProvider.preset.description": "로컬 모델 서버, 엔드포인트, 또는 ACP 에이전트를 선택하세요.",
  "customProvider.preset.heading": "사용자 지정 추가",
  "customProvider.preset.subtitle": "OpenCode용 모델 또는 독립 에이전트.",
  "customProvider.preset.models": "모델",
  "customProvider.preset.agents": "에이전트",
  "customProvider.preset.ollama": "Ollama",
  "customProvider.preset.ollamaDescription": "127.0.0.1:11434의 로컬 모델.",
  "customProvider.preset.lmstudio": "LM Studio",
  "customProvider.preset.lmstudioDescription": "127.0.0.1:1234의 로컬 모델.",
  "customProvider.preset.openaiCompatible": "OpenAI 호환 엔드포인트",
  "customProvider.preset.openaiCompatibleDescription": "OpenAI 채팅 API를 제공하는 모든 서버.",
  "customProvider.probe.checking": "확인 중",
  "customProvider.probe.running": { other: "실행 중 · 모델 {count}개" },

  // Automatic detection on the provider step and in Settings. OpenBot looks for local model servers
  // at their default addresses and for known ACP agent commands on the PATH.
  "customProvider.detected.title": "이 컴퓨터에서 찾았어요",
  "customProvider.detected.scanning": "로컬 모델과 에이전트를 찾는 중이에요.",
  "customProvider.detected.scanAgain": "다시 검색",
  "customProvider.detected.empty": "Dengerbot이 로컬 모델 서버나 ACP 에이전트를 찾지 못했어요.",
  "customProvider.detected.add": "추가",
  "customProvider.detected.addLabel": "{name} 추가",
  "customProvider.detected.added": "추가됨",
  "customProvider.detected.nameVersion": "{name} {version}",
  "customProvider.detected.modelsDetail": {
    other: "모델 {count}개 · {location}",
  },
  "customProvider.detected.agentDetail": "ACP 에이전트 · {location}",
  "customProvider.detected.edit": "편집",
  "customProvider.detected.editLabel": "{name} 편집",
  "customProvider.detected.hide": "{name} 숨기기",
  "customProvider.detected.showHidden": "숨긴 항목 보기 ({count})",

  // Where the scan looks. The default addresses and PATH are always part of it.
  "customProvider.detection.title": "로컬 감지",
  "customProvider.detection.saveFailed": "감지 설정을 저장할 수 없었어요.",
  "customProvider.detection.description": "Dengerbot이 로컬 모델 서버와 ACP 에이전트를 찾는 위치예요.",
  "customProvider.detection.enabled": "로컬 모델과 에이전트 찾기",
  "customProvider.detection.enabledDescription":
    "Dengerbot이 Ollama와 LM Studio의 기본 주소를 확인하고, PATH에서 알려진 ACP 에이전트를 찾아요.",
  "customProvider.detection.addresses": "기타 모델 서버 주소",
  "customProvider.detection.address.label": "주소 {number}",
  "customProvider.detection.address.remove": "주소 {number} 제거",
  "customProvider.detection.address.add": "주소 추가",
  "customProvider.detection.folders": "에이전트용 기타 폴더",
  "customProvider.detection.folder.label": "폴더 {number}",
  "customProvider.detection.folder.remove": "폴더 {number} 제거",
  "customProvider.detection.folder.add": "폴더 추가",
  "customProvider.detection.error.folderInvalid": "{example}처럼 전체 경로를 입력해 주세요.",

  // The custom ACP agent form.

  // The user's own ACP agents in Settings. Each is a command that OpenBot starts on this computer.
} as const satisfies PartialTranslation<typeof source>;
