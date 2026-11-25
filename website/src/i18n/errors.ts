import type { Locale } from "./locales";

// What the server actions answer when something fails, in the reader's language. The
// data layer and the code reader keep writing English, so this is the one place an
// error changes language: on its way out of src/app/actions.ts. errors.test.ts fails
// when a new English message has no Russian here.

const RU: Record<string, string> = {
  // Signing in
  "Sign in to bookmark a look.": "Войдите, чтобы добавить образ в закладки.",
  "Sign in to change your look.": "Войдите, чтобы изменить свой образ.",
  "Sign in to choose a name.": "Войдите, чтобы выбрать имя.",
  "Sign in to comment.": "Войдите, чтобы оставить комментарий.",
  "Sign in to delete a look.": "Войдите, чтобы удалить образ.",
  "Sign in to link your game.": "Войдите, чтобы привязать игру.",
  "Sign in to publish.": "Войдите, чтобы опубликовать.",
  "Sign in to report a comment.": "Войдите, чтобы пожаловаться на комментарий.",
  "Sign in to report a look.": "Войдите, чтобы пожаловаться на образ.",
  "Sign in to send looks to your game.": "Войдите, чтобы отправлять образы в игру.",
  "Sign in to upload.": "Войдите, чтобы загружать файлы.",
  "Sign in to vote.": "Войдите, чтобы голосовать.",

  // Publishing and editing looks
  "Add at least one screenshot.": "Добавьте хотя бы один скриншот.",
  "Another public look has the same code, so this one stays private.": "У другого публичного образа такой же код, поэтому этот остаётся скрытым.",
  "Choose a public name first, from the account button.": "Сначала выберите публичное имя в меню аккаунта.",
  "Give it a title of at least 3 letters.": "Название должно быть не короче 3 букв.",
  "Publishing is not open yet: the community database is not connected.": "Публикация пока недоступна: база сообщества не подключена.",
  "That is 20 looks this hour. Try again later.": "Это уже 20 образов за час. Попробуйте позже.",
  "That look cannot be changed.": "Этот образ нельзя изменить.",
  "That look cannot be deleted.": "Этот образ нельзя удалить.",
  "That look could not be changed. Try again.": "Не удалось изменить образ. Попробуйте ещё раз.",
  "That look could not be changed.": "Не удалось изменить образ.",
  "That look could not be deleted. Try again.": "Не удалось удалить образ. Попробуйте ещё раз.",
  "That look is gone.": "Этого образа больше нет.",
  "That outfit could not be saved. Try again.": "Не удалось сохранить образ. Попробуйте ещё раз.",
  "This look is already in the Community Gallery.": "Этот образ уже есть в Галерее сообщества.",
  "You can only change your own looks.": "Изменять можно только свои образы.",
  "You can only delete your own looks.": "Удалять можно только свои образы.",

  // Screenshots and pictures
  "Choose a screenshot first.": "Сначала выберите скриншот.",
  "Keep each screenshot under 4 MB.": "Каждый скриншот должен быть меньше 4 МБ.",
  "Screenshots can be PNG, JPEG or WebP.": "Скриншоты могут быть в формате PNG, JPEG или WebP.",
  "That file could not be read as an image.": "Этот файл не удалось прочитать как изображение.",
  "That is not an uploaded screenshot.": "Это не загруженный скриншот.",
  "That is not one of the set's pictures.": "Это не изображение из этого комплекта.",
  "That picture could not be removed. Try again.": "Не удалось удалить изображение. Попробуйте ещё раз.",
  "That picture could not be removed.": "Не удалось удалить изображение.",
  "That screenshot could not be removed.": "Не удалось удалить скриншот.",
  "That screenshot could not be stored. Try again.": "Не удалось сохранить скриншот. Попробуйте ещё раз.",
  "Upload screenshots from this computer.": "Загружайте скриншоты с этого компьютера.",
  "You have 60 screenshots stored. Delete a look to free some up.": "У вас сохранено 60 скриншотов. Удалите образ, чтобы освободить место.",

  // Votes, bookmarks and reports
  "Choose a reason first.": "Сначала выберите причину.",
  "Only moderators can dismiss reports.": "Отклонять жалобы могут только модераторы.",
  "That bookmark could not be saved. Try again.": "Не удалось сохранить закладку. Попробуйте ещё раз.",
  "That look cannot be bookmarked.": "Этот образ нельзя добавить в закладки.",
  "That look cannot be reported.": "На этот образ нельзя пожаловаться.",
  "That look cannot be voted on.": "За этот образ нельзя голосовать.",
  "That look has no reports to dismiss.": "На этот образ нет жалоб.",
  "That report could not be sent. Try again.": "Не удалось отправить жалобу. Попробуйте ещё раз.",
  "That vote could not be counted. Try again.": "Голос не засчитан. Попробуйте ещё раз.",
  "Those reports could not be dismissed. Try again.": "Не удалось отклонить жалобы. Попробуйте ещё раз.",

  // Comments
  "That comment cannot be removed.": "Этот комментарий нельзя удалить.",
  "That comment cannot be reported.": "На этот комментарий нельзя пожаловаться.",
  "That comment could not be posted. Try again.": "Не удалось опубликовать комментарий. Попробуйте ещё раз.",
  "That comment could not be removed. Try again.": "Не удалось удалить комментарий. Попробуйте ещё раз.",
  "That comment has no reports to dismiss.": "На этот комментарий нет жалоб.",
  "That is a lot of comments at once. Try again in a few minutes.": "Слишком много комментариев подряд. Попробуйте через несколько минут.",
  "That look cannot be commented on.": "Этот образ нельзя комментировать.",
  "Write something first.": "Сначала напишите что-нибудь.",
  "You can only remove your own comments, or those on your looks.": "Удалять можно только свои комментарии или комментарии к своим образам.",

  // Names
  "That name could not be saved. Try again.": "Не удалось сохранить имя. Попробуйте ещё раз.",
  "That name is taken. Try another.": "Это имя занято. Попробуйте другое.",
  "Use at least 2 characters.": "Используйте не меньше 2 символов.",
  "Use letters, numbers, spaces and . _ ' - only.": "Используйте только буквы, цифры, пробелы и . _ ' -",

  // Codes, the game and its sets
  "That game could not be unlinked. Try again.": "Не удалось отвязать игру. Попробуйте ещё раз.",
  "That code is too long to be a look.": "Этот код слишком длинный для образа.",
  "That is not an Eclipse code. Codes start with ECA1: or ECW1:.": "Это не код Eclipse. Коды начинаются с ECA1: или ECW1:.",
  "That is not an Eclipse loadout code. Copy it again with Share in the game.": "Это не код комплекта Eclipse. Скопируйте его снова через «Поделиться» в игре.",
  "That is not an Eclipse world code. Copy it again with Share on Colors > World.": "Это не код мира Eclipse. Скопируйте его снова через «Поделиться» в разделе Colors > World.",
  "That look could not be sent. Try again.": "Не удалось отправить образ. Попробуйте ещё раз.",
  "That set could not be removed. Try again.": "Не удалось удалить комплект. Попробуйте ещё раз.",
  "That text is too long to be a code.": "Этот текст слишком длинный для кода.",
  "This look is too large to send. Copy its code instead.": "Этот образ слишком большой для отправки. Скопируйте его код.",
  "Your sets are full. Remove one to make room.": "Все места для комплектов заняты. Удалите один, чтобы освободить место.",
};

/** Messages with a number in them: the English pattern and the Russian it becomes. */
const RU_PATTERNS: [RegExp, string][] = [
  [/^Keep it to (\d+) characters\.$/, "Не длиннее $1 символов."],
  [/^Keep the description to (\d+) characters\.$/, "Описание не длиннее $1 символов."],
  [/^Keep it to (\d+) screenshots\.$/, "Не больше $1 скриншотов."],
];

/** The error in the reader's language; English, unchanged, for one this list lacks. */
export function errorIn(locale: Locale, message: string): string {
  if (locale !== "ru") return message;
  if (Object.hasOwn(RU, message)) return RU[message];
  for (const [pattern, russian] of RU_PATTERNS) if (pattern.test(message)) return message.replace(pattern, russian);
  return message;
}
