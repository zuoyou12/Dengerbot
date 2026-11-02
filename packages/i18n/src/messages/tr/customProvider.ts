import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/customProvider";

export const messages = {
  // Form doğrulama. Her mesaj özel sağlayıcı formunun bir alanını adlandırır.
  "customProvider.error.providerIdRequired": "Bir sağlayıcı kimliği girin.",
  "customProvider.error.providerIdPattern":
    "Bir harf veya rakamla başlayan küçük harfler, rakamlar, kısa çizgiler veya alt çizgiler kullanın.",
  "customProvider.error.providerIdLength": "Sağlayıcı kimliğini en fazla {max} karakter tutun.",
  "customProvider.error.providerIdBuiltIn": "Dengerbot'ta zaten {id} adında bir sağlayıcı var. Başka bir kimlik seçin.",
  "customProvider.error.providerIdSaved":
    "{id} adlı bir uç nokta zaten kayıtlı. Önce onu kaldırın veya başka bir kimlik seçin.",
  "customProvider.error.displayNameRequired": "Bir görünen ad girin.",
  "customProvider.error.displayNameLength": "Görünen adı en fazla {max} karakter tutun.",
  "customProvider.error.apiKeyLength": "API anahtarını en fazla {max} karakter tutun.",
  "customProvider.error.modelsRequired": "En az bir model ekleyin.",
  "customProvider.error.modelsLimit": "En fazla {max} model ekleyin.",
  "customProvider.error.modelIdRequired": "Bir model kimliği girin.",
  "customProvider.error.modelIdDuplicate": "Bu sağlayıcıda zaten {id} listeleniyor.",
  "customProvider.error.modelIdInvalid":
    "Bu model kimliği kullanılamaz. Boşlukları, tırnak işaretlerini ve diğer noktalama işaretlerini kaldırın.",
  "customProvider.error.headerNameRequired": "Bir başlık adı girin.",
  "customProvider.error.headerNameInvalid": "Geçerli bir HTTP başlık adı kullanın.",
  "customProvider.error.headerDuplicate": "Bu sağlayıcıda zaten {name} ayarlanmış.",
  "customProvider.error.headerValueRequired": "Bir başlık değeri girin.",
  "customProvider.error.headersLimit": "En fazla {max} başlık ekleyin.",
  "customProvider.error.baseUrlRequired": "Bir temel URL girin.",
  "customProvider.error.baseUrlLength": "Temel URL'yi en fazla {max} karakter tutun.",
  "customProvider.error.baseUrlInvalid": "{example} gibi tam bir URL girin.",
  "customProvider.error.baseUrlProtocol": "Bir http:// veya https:// URL'si kullanın.",
  "customProvider.error.baseUrlCredential": "Kimlik bilgilerini URL'ye değil, bir başlığa koyun.",

  // Kaydetme veya kaldırma işleminden sonraki not. OpenCode'un yeni listeyi ne zaman okuduğunu belirtir.
  "customProvider.saved.restarted": "Kaydedildi. Dengerbot modelleri yüklüyor.",
  "customProvider.saved.skippedBusy": "Kaydedildi. OpenCode listeyi geçerli görev durduktan sonra okur.",
  "customProvider.saved.notRunning": "Kaydedildi. OpenCode bir sonraki başlatılışında listeyi okur.",
  "customProvider.removed.restarted": "Kaldırıldı. Dengerbot modelleri yüklüyor.",
  "customProvider.removed.skippedBusy": "Kaldırıldı. OpenCode listeyi geçerli görev durduktan sonra okur.",
  "customProvider.removed.notRunning": "Kaldırıldı. OpenCode bir sonraki başlatılışında listeyi okur.",
  "customProvider.saveFailed": "Dengerbot bu uç noktayı kaydedemedi.",
  "customProvider.removeFailed": "Dengerbot {name} öğesini kaldıramadı.",
  "customProvider.saveUnavailable": "Bu derleme bir uç noktayı kaydedemez.",
  "customProvider.removeUnavailable": "Bu derleme bir uç noktayı kaldıramaz.",

  // Ekleme iletişim kutusu.
  "customProvider.form.title": "Özel sağlayıcı ekle",
  "customProvider.form.editTitle": "Özel sağlayıcıyı düzenle",
  "customProvider.form.description": "OpenAI uyumlu bir uç noktayı ve sunduğu modelleri tanımlayın.",
  "customProvider.form.heading": "Özel sağlayıcı",
  "customProvider.form.subtitle": "Herhangi bir OpenAI uyumlu uç nokta.",
  "customProvider.field.providerId": "Sağlayıcı kimliği",
  "customProvider.field.providerIdHint": "Küçük harfler, rakamlar, kısa çizgiler veya alt çizgiler.",
  "customProvider.field.displayName": "Görünen ad",
  "customProvider.field.displayNamePlaceholder": "Sağlayıcım",
  "customProvider.field.baseUrl": "Temel URL",
  "customProvider.field.apiKey": "API anahtarı",
  "customProvider.field.apiKeyHint": "İsteğe bağlı. Kimlik doğrulamasını başlıklarla yönetiyorsanız boş bırakın.",
  "customProvider.field.apiKeyKeptHint":
    "Bir anahtar kayıtlı. Bunu ve kayıtlı başlıkları korumak için burayı boş bırakın.",
  "customProvider.models": "Modeller",
  "customProvider.model.id": "{number}. model kimliği",
  "customProvider.model.name": "{number}. model görünen adı",
  "customProvider.model.namePlaceholder": "Görünen Ad",
  "customProvider.model.remove": "{number}. modeli kaldır",
  // The saved endpoints list: its heading, its rows and the delete confirmation.
  "customProvider.list.title": "Özel uç noktalar",
  "customProvider.list.description": "Bu bilgisayara eklediğiniz uç noktalar.",
  "customProvider.list.subtitle": "Bu bilgisayarda kaydedilen OpenAI uyumlu uç noktalar",
  "customProvider.list.empty": "Henüz uç nokta yok. Modellerini kullanmak için bir tane ekleyin.",
  "customProvider.list.label": "Kayıtlı uç noktalar",
  "customProvider.list.apiKeySaved": "API anahtarı kaydedildi",
  "customProvider.list.deleteLabel": "{name} silinsin",
  "customProvider.list.editLabel": "{name} düzenlensin",
  "customProvider.list.confirmTitle": "{name} kaldırılsın mı?",
  "customProvider.list.confirmDescription":
    "Uç nokta ve modelleri bu bilgisayardan kaldırılır. Kullanan ajanlar başka bir model seçer.",
  "customProvider.model.add": "Model ekle",
  "customProvider.headers": "Başlıklar",
  "customProvider.header.name": "{number}. başlık adı",
  "customProvider.header.value": "{number}. başlık değeri",
  "customProvider.header.valuePlaceholder": "değer",
  "customProvider.header.remove": "{number}. başlığı kaldır",
  "customProvider.header.add": "Başlık ekle",
  "customProvider.submit": "Gönder",

  // Model keşfi. OpenBot uç noktaya model listesini sorar ve kullanıcı listeden seçer.
  "customProvider.discovery.find": "Modelleri bul",
  "customProvider.discovery.refresh": "Tekrar bul",
  "customProvider.discovery.loading": "{url} adresine modelleri soruluyor.",
  "customProvider.discovery.found": {
    one: "Uç nokta {count} model listeliyor. Eklenecek modelleri seçin.",
    other: "Uç nokta {count} model listeliyor. Eklenecek modelleri seçin.",
  },
  "customProvider.discovery.empty": "Uç nokta hiçbir model listelemiyor. Model kimliklerini kendiniz ekleyin.",
  "customProvider.discovery.label": "Uç noktanın listelediği modeller",

  // Ekleme akışının ilk adımı: hazır bir ayar bir sonraki formu doldurur.
  "customProvider.preset.title": "Sağlayıcı veya ajan ekle",
  "customProvider.preset.description": "Yerel bir model sunucusu, bir uç nokta veya bir ACP ajanı seçin.",
  "customProvider.preset.heading": "Özel ekle",
  "customProvider.preset.subtitle": "OpenCode için modeller veya kendine ait bir ajan.",
  "customProvider.preset.models": "Modeller",
  "customProvider.preset.agents": "Ajanlar",
  "customProvider.preset.ollama": "Ollama",
  "customProvider.preset.ollamaDescription": "127.0.0.1:11434 adresindeki yerel modeller.",
  "customProvider.preset.lmstudio": "LM Studio",
  "customProvider.preset.lmstudioDescription": "127.0.0.1:1234 adresindeki yerel modeller.",
  "customProvider.preset.openaiCompatible": "OpenAI uyumlu uç nokta",
  "customProvider.preset.openaiCompatibleDescription": "OpenAI sohbet API'sine sahip herhangi bir sunucu.",
  "customProvider.probe.checking": "Kontrol ediliyor",
  "customProvider.probe.running": {
    one: "Çalışıyor · {count} model",
    other: "Çalışıyor · {count} model",
  },

  // Sağlayıcı adımında ve Ayarlar'da otomatik algılama. OpenBot yerel model sunucularını
  // varsayılan adreslerinde ve PATH'teki bilinen ACP ajanı komutlarını arar.
  "customProvider.detected.title": "Bu bilgisayarda bulundu",
  "customProvider.detected.scanning": "Yerel modeller ve ajanlar aranıyor.",
  "customProvider.detected.scanAgain": "Tekrar tara",
  "customProvider.detected.empty": "Dengerbot yerel bir model sunucusu veya ACP ajanı bulamadı.",
  "customProvider.detected.add": "Ekle",
  "customProvider.detected.addLabel": "{name} sağlayıcısını ekle",
  "customProvider.detected.added": "Eklendi",
  "customProvider.detected.nameVersion": "{name} {version}",
  "customProvider.detected.modelsDetail": {
    one: "{count} model · {location}",
    other: "{count} model · {location}",
  },
  "customProvider.detected.agentDetail": "ACP ajanı · {location}",
  "customProvider.detected.edit": "Düzenle",
  "customProvider.detected.editLabel": "{name} sağlayıcısını düzenle",
  "customProvider.detected.hide": "{name} sağlayıcısını gizle",
  "customProvider.detected.showHidden": "Gizlenenleri göster ({count})",

  // Taramanın baktığı yer. Varsayılan adresler ve PATH her zaman bunun bir parçasıdır.
  "customProvider.detection.title": "Yerel algılama",
  "customProvider.detection.saveFailed": "Algılama ayarları kaydedilemedi.",
  "customProvider.detection.description": "Dengerbot'un yerel model sunucularını ve ACP ajanlarını arayacağı yerler.",
  "customProvider.detection.enabled": "Yerel modelleri ve ajanları ara",
  "customProvider.detection.enabledDescription":
    "Dengerbot, Ollama ve LM Studio'nun varsayılan adreslerini kontrol eder ve PATH'inizde bilinen ACP ajanlarını arar.",
  "customProvider.detection.addresses": "Diğer model sunucusu adresleri",
  "customProvider.detection.address.label": "{number}. adres",
  "customProvider.detection.address.remove": "{number}. adresi kaldır",
  "customProvider.detection.address.add": "Adres ekle",
  "customProvider.detection.folders": "Ajanlar için diğer klasörler",
  "customProvider.detection.folder.label": "{number}. klasör",
  "customProvider.detection.folder.remove": "{number}. klasörü kaldır",
  "customProvider.detection.folder.add": "Klasör ekle",
  "customProvider.detection.error.folderInvalid": "{example} gibi tam bir yol girin.",

  // Özel ACP ajanı formu.

  // Ayarlar'daki kullanıcının kendi ACP ajanları. Her biri OpenBot'un bu bilgisayarda başlattığı bir komuttur.
} as const satisfies PartialTranslation<typeof source>;
