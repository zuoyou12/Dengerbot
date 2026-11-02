import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sitePage";

export const messages = {
  "sitePage.error.title": "Не удалось загрузить страницу",
  "sitePage.error.body":
    "Проверьте подключение и перезагрузите страницу. Если она всё ещё не загружается, вернитесь на главную страницу.",
  "sitePage.error.reload": "Перезагрузить",
  "sitePage.error.home": "На главную",
  "sitePage.join.title": "Присоединиться к серверу Dengerbot",
  "sitePage.join.description": "Откройте частное приглашение на сервер в Dengerbot.",
  "sitePage.join.eyebrow": "Частное приглашение",
  "sitePage.join.intro":
    "Откройте это приглашение в Dengerbot. Приложение проверит сервер и попросит подтверждения перед подключением.",
  "sitePage.join.invalid":
    "Эта ссылка-приглашение недействительна или неполна. Попросите владельца сервера о новом приглашении.",
  "sitePage.join.open": "Открыть Dengerbot",
  "sitePage.join.browser": "Открыть в браузере",
  "sitePage.join.download": "Скачать Dengerbot",
  "sitePage.join.notOpened":
    "Если Dengerbot не открылся, установите его кнопкой «{download}» или запустите Dengerbot один раз, чтобы он мог открывать ссылки-приглашения. Также можно использовать кнопку «{browser}».",
  "sitePage.join.mobile":
    "Если Dengerbot установлен, нажмите «{open}». Также можно вставить эту ссылку в «Добавить сервер» в приложении.",
  "sitePage.join.singleUse":
    "Одноразовая ссылка работает один раз, затем истекает. Постоянная ссылка работает, пока владелец её не отзовёт. Dengerbot показывает срок действия до того, как вы присоединитесь.",
  "sitePage.join.email": "Если приглашение пришло по электронной почте, войдите в Dengerbot с этим адресом.",
  "sitePage.join.share": "Эта ссылка даёт доступ к серверу. Делитесь ею только с теми, кого хотите пригласить.",
  "sitePage.connect.title": "Вернуться в Dengerbot",
  "sitePage.connect.failedTitle": "Подключение не завершено",
  "sitePage.connect.openApp": "Открыть Dengerbot",
  "sitePage.connect.tryAgainApp": "Повторить в Dengerbot",
  "sitePage.connect.tryAgainBrowser": "Повторить в браузере",
  "sitePage.connect.doneInWebClient":
    "Ваша вкладка Dengerbot завершает подключение к {name}. Эту вкладку можно закрыть.",
  "sitePage.connect.doneInApp": "Dengerbot завершает подключение к {name} на вашем компьютере.",
  "sitePage.connect.failure.cancelled": "Подключение к {name} отменено. Ничего не изменилось.",
  "sitePage.connect.failure.expired": "Срок входа в {name} истёк. Начните подключение снова.",
  "sitePage.connect.failure.exchange": "{name} не подтвердил подключение. Попробуйте снова.",
  "sitePage.connect.failure.enterprise": "Подключите одно рабочее пространство Slack, а не всю организацию.",
  "sitePage.connect.failure.takenSlack":
    "Другой сервер Dengerbot уже отвечает в этом рабочем пространстве Slack. Отключите его на том сервере и попробуйте снова.",
  "sitePage.connect.failure.takenDiscord":
    "Другой сервер Dengerbot уже отвечает на этом сервере Discord. Отключите его на том сервере и попробуйте снова.",
  "sitePage.connect.failure.unavailable": "Dengerbot сейчас не может подключиться к {name}. Попробуйте позже.",
  "sitePage.connect.failure.tabClosed":
    "Вкладка Dengerbot, которая начала подключение к {name}, не ответила. Откройте Dengerbot в браузере и подключите {name} снова.",
  "sitePage.connect.failure.failed": "{name} не завершил подключение. Попробуйте снова.",
  "sitePage.connect.restartHint":
    "В Dengerbot откройте «{marketplace}», затем «{apps}», затем {name} и выберите «{connect}».",
  "sitePage.connect.notOpened":
    "Запустите Dengerbot и попробуйте снова. Если Dengerbot нет на этом компьютере, скачайте его и подключите {name} в приложении.",
  "sitePage.openApp.title": "Ничего не открылось?",
  "sitePage.openApp.dismiss": "Не сейчас",
  "sitePage.billing.pageTitle": "Оплата Dengerbot",
  "sitePage.billing.updatedTitle": "Оплата обновлена",
  "sitePage.billing.updatedBody": "Вернитесь в Dengerbot. Эту страницу можно закрыть.",
  "sitePage.billing.cancelledTitle": "Оплата отменена",
  "sitePage.billing.cancelledBody": "Деньги не списаны. Вернитесь в Dengerbot.",
  "sitePage.report.pageTitle": "Пожаловаться на размещённый сайт — Dengerbot",
  "sitePage.report.title": "Пожаловаться на размещённый сайт",
  "sitePage.report.intro": "Отправьте жалобу на вредный или незаконный контент по адресу openbot.site.",
  "sitePage.report.hostnameLabel": "Адрес сайта",
  "sitePage.report.hostnameMissing": "Введите адрес сайта",
  "sitePage.report.reasonLabel": "Причина",
  "sitePage.report.reason.phishing": "Фишинг",
  "sitePage.report.reason.malware": "Вредоносное ПО",
  "sitePage.report.reason.abuse": "Злоупотребление",
  "sitePage.report.reason.copyright": "Авторское право",
  "sitePage.report.reason.other": "Другое",
  "sitePage.report.detailsLabel": "Подробности",
  "sitePage.report.optional": "Необязательно",
  "sitePage.report.detailsPlaceholder": "Что не так с этим сайтом?",
  "sitePage.report.send": "Отправить",
  "sitePage.report.sending": "Отправка…",
  "sitePage.report.tooMany": "Слишком много жалоб. Попробуйте позже.",
  "sitePage.report.sendFailed": "Не удалось отправить жалобу. Попробуйте снова.",
  "sitePage.report.writeTo": "Также можно написать на {email}.",
  "sitePage.report.sentTitle": "Жалоба отправлена",
  "sitePage.report.sentBody": "Спасибо. Мы получили вашу жалобу.",
  "sitePage.report.home": "На главную страницу",
} as const satisfies PartialTranslation<typeof source>;
