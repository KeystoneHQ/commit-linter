/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const util = require('util');

// pnpm wont resolve this package's dependencies as npm does
// unless `pnpm install --shamefully-hoist`. What a shame!
// issue#13 https://github.com/legend80s/commit-msg-linter/issues/13
// So it had to be degraded to not use this two packages.
let Matcher;
try {
  // eslint-disable-next-line global-require
  Matcher = require('did-you-mean');
} catch (error) {
  // DO NOTHING
  // on MODULE_NOT_FOUND when installed by pnpm
}

let supportsColor = { stdout: true };
try {
  // eslint-disable-next-line global-require
  supportsColor = require('supports-color');
} catch (error) {
  // DO NOTHING
  // on MODULE_NOT_FOUND when installed by pnpm
}

const LANG = getLangs();

const readFile = util.promisify(fs.readFile);

// Any line of the commit message cannot be longer than 100 characters!
// This allows the message to be easier to read on github as well as in various git tools.
// https://docs.google.com/document/d/1QrDFcIiPjSLDn3EL15IJygNPiHORgU1_OOAqWjiDU5Y/edit
const MAX_LENGTH = 100;
const MIN_LENGTH = 10;

/* eslint-enable no-useless-escape */
const IGNORED_PATTERNS = [
  /(^WIP:)|(^\d+\.\d+\.\d+)/,

  /^Publish$/,

  // ignore auto-generated commit msg
  /^((Merge pull request)|(Merge (.*?) into (.*?)|(Merge branch (.*?)))(?:\r?\n)*$)/m,
];

const colorSupported = supportsColor.stdout;

const YELLOW = colorSupported ? '\x1b[1;33m' : '';
const GRAY = colorSupported ? '\x1b[0;37m' : '';
const RED = colorSupported ? '\x1b[0;31m' : '';
const GREEN = colorSupported ? '\x1b[0;32m' : '';

/** End Of Style, removes all attributes (formatting and colors) */
const EOS = colorSupported ? '\x1b[0m' : '';
const BOLD = colorSupported ? '\x1b[1m' : '';

async function main() {
  const commitMsgFilePath = '.git/COMMIT_EDITMSG';
  const commitlinterrcFilePath = path.resolve(__dirname, 'commitlinterrc.json');

  // console.log(commitlinterrcFilePath);

  try {
    const [commitMsgContent, config] = await Promise.all([
      readFile(commitMsgFilePath),
      readConfig(commitlinterrcFilePath),
    ]);

    const lang = getLanguage(config.lang);

    lint(commitMsgContent, config, lang);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();

/**
 * Returns the given language's data if the language exists.
 * Otherwise, returns the data for the English language.
 *
 * @param {string} lang Language
 * @returns
 */
function getLangData(lang) {
  return LANG[lang] ? LANG[lang] : LANG['en-US'];
}

/**
 * @param {string} commitMsgContent
 * @param {string} config
 *
 * @returns {void}
 */
async function lint(commitMsgContent, config, lang) {
  const DESCRIPTIONS = getLangData(lang).descriptions;

  const {
    example,
    scope,
    invalidScope,
    subject,
    invalidSubject,
  } = DESCRIPTIONS;

  const {
    types,
    'max-len': maxLength,
    'min-len': minLength,
    debug: verbose = false,
    showInvalidHeader = true,

    scopeDescriptions = scope,
    invalidScopeDescriptions = invalidScope,

    subjectDescriptions = subject,
    invalidSubjectDescriptions = invalidSubject,

    postSubjectDescriptions = [],
  } = config;

  verbose && debug('config:', config);

  const msg = getFirstLine(commitMsgContent).replace(/\s{2,}/g, ' ');
  const STEREOTYPES = getLangData(lang).stereotypes;
  const mergedTypes = merge(STEREOTYPES, types);
  const maxLen = typeof maxLength === 'number' ? maxLength : MAX_LENGTH;
  const minLen = typeof minLength === 'number' ? minLength : MIN_LENGTH;

  if (!validateMessage(msg, {
    mergedTypes,
    maxLen,
    minLen,
    verbose,
    example,
    showInvalidHeader,
    scopeDescriptions,
    invalidScopeDescriptions,
    subjectDescriptions,
    invalidSubjectDescriptions,
    postSubjectDescriptions,

    lang,
  })) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

/**
 * @param {string} filename
 * @returns {Promise<Object>} return empty object when read file error or content invalid json
 */
async function readConfig(filename) {
  const packageName = `${YELLOW}git-commit-msg-linter`;
  let content = '{}';

  try {
    content = await readFile(filename);
  } catch (error) {
    if (error.code === 'ENOENT') {
      /** pass, as commitlinterrc are optional */
    } else {
      /** pass, commitlinterrc ignored when invalid */
      /** It must be a bug so output the error to the user */
      console.error(`${packageName}: ${RED}read commitlinterrc.json failed`, error);
    }
  }

  let config = {};

  try {
    config = JSON.parse(content);
  } catch (error) {
    /** pass, commitlinterrc ignored when invalid json */
    /** output the error to the user for self-checking */
    console.error(`${packageName}: ${RED}commitlinterrc.json ignored because of invalid json`);
  }

  return config;
}

function merge(stereotypes, configTypes) {
  return compact({ ...stereotypes, ...configTypes }, { strictFalse: true });
}

/**
 * Create a new Object with all falsy values removed.
 * The values false, null, 0, "", undefined, and NaN are falsy when `strictFalse` is false,
 * Otherwise when `strictFalse` is true the only falsy value is false.
 * @param {Object} obj
 * @param {boolean} options.strictFalse
 * @returns {Object}
 */
function compact(target, { strictFalse = false } = {}) {
  return Object.keys(target).reduce((acc, key) => {
    const shouldBeRemoved = strictFalse ? target[key] === false : !target[key];

    return shouldBeRemoved ? acc : { ...acc, [key]: target[key] };
  }, {});
}

function getFirstLine(buffer) {
  return buffer.toString().split('\n').shift();
}

/**
 * validate git message
 *
 * @param {string} message
 * @param {Object} options.mergedTypes ??? commitlinterrc merge ?????? types
 * @param {number} options.maxLen ????????????????????????
 * @param {boolean} options.verbose ???????????? debug ??????
 * @returns {boolean}
 */
function validateMessage(
  message,
  {
    mergedTypes,
    maxLen,
    minLen,
    verbose,
    example,
    showInvalidHeader,
    scopeDescriptions,
    invalidScopeDescriptions,
    subjectDescriptions,
    postSubjectDescriptions,
    invalidSubjectDescriptions,
    lang,
  },
) {
  let isValid = true;
  let invalidLength = false;

  if (IGNORED_PATTERNS.some((pattern) => pattern.test(message))) {
    console.log('Commit message validation ignored.');
    return true;
  }

  verbose && debug(`commit message: |${message}|`);

  if (message.length > maxLen || message.length < minLen) {
    invalidLength = true;
    isValid = false;
  }

  // if (/[\u3220-\uFA29]+/.test(message)) {
  //   console.error(`${COLOR}commit text can not contain chinese characters`);
  //   isValid = false;
  // }

  const matches = resolvePatterns(message);

  if (!matches) {
    displayError(
      { invalidLength, invalidFormat: true },
      {
        mergedTypes,
        maxLen,
        minLen,
        message,
        example,
        showInvalidHeader,
        scopeDescriptions,
        invalidScopeDescriptions,
        subjectDescriptions,
        postSubjectDescriptions,
        invalidSubjectDescriptions,
        lang,
      },
    );

    return false;
  }

  const { type, scope, subject } = matches;

  verbose && debug(`type: ${type}, scope: ${scope}, subject: ${subject}`);

  const types = Object.keys(mergedTypes);
  const typeInvalid = !types.includes(type);

  // scope can be optional, but not empty string
  // "test: hello" OK
  // "test(): hello" FAILED
  const invalidScope = typeof scope === 'string' && scope.trim() === '';

  // Don't capitalize first letter; No dot (.) at the end
  const invalidSubject = isUpperCase(subject[0]) || subject.endsWith('.');

  if (invalidLength || typeInvalid || invalidScope || invalidSubject) {
    displayError(
      {
        invalidLength, type, typeInvalid, invalidScope, invalidSubject,
      },
      {
        mergedTypes,
        maxLen,
        minLen,
        message,
        example,
        showInvalidHeader,
        scopeDescriptions,
        invalidScopeDescriptions,
        subjectDescriptions,
        postSubjectDescriptions,
        invalidSubjectDescriptions,
        lang,
      },
    );

    return false;
  }

  return isValid;
}

function displayError(
  {
    invalidLength = false,
    invalidFormat = false,
    type,
    typeInvalid = false,
    invalidScope = false,
    invalidSubject = false,
  } = {},
  {
    mergedTypes,
    maxLen,
    minLen,
    message,
    example,
    showInvalidHeader,
    scopeDescriptions,
    invalidScopeDescriptions,
    subjectDescriptions,
    postSubjectDescriptions,
    invalidSubjectDescriptions,
    lang,
  },
) {
  const decoratedType = decorate('type', typeInvalid);
  const scope = decorate('scope', invalidScope, true);
  const subject = decorate('subject', invalidSubject);

  const types = Object.keys(mergedTypes);
  const suggestedType = suggestType(type, types);
  const typeDescriptions = describeTypes(mergedTypes, suggestedType);

  const invalid = invalidLength || invalidFormat || typeInvalid || invalidScope || invalidSubject;
  const translated = getLangData(lang).i18n;
  const { invalidHeader } = translated;
  const header = !showInvalidHeader
    ? ''
    : `\n  ${invalidFormat ? RED : YELLOW}************* ${invalidHeader} **************${EOS}`;

  const scopeDescription = scopeDescriptions.join('\n    ');
  const invalidScopeDescription = invalidScopeDescriptions.join('\n    ');
  const defaultInvalidScopeDescription = `scope can be ${emphasis('optional')}${RED}, but its parenthesis if exists cannot be empty.`;

  const subjectDescription = subjectDescriptions.join('\n    ');
  let postSubjectDescription = postSubjectDescriptions.join('\n    ');
  postSubjectDescription = postSubjectDescription ? `\n\n    ${italic(postSubjectDescription)}` : '';

  const invalidSubjectDescription = invalidSubjectDescriptions.join('\n    ');

  const { example: labelExample, correctFormat, commitMessage } = translated;

  const correctedExample = typeInvalid
    ? didYouMean(message, { example, types })
    : example;

  console.info(
    `${header}${invalid ? `
  ${label(`${commitMessage}:`)} ${RED}${message}${EOS}` : ''}${generateInvalidLengthTips(message, invalidLength, maxLen, minLen, lang)}
  ${label(`${correctFormat}:`)} ${GREEN}${decoratedType}${scope}: ${subject}${EOS}
  ${label(`${labelExample}:`)} ${GREEN}${correctedExample}${EOS}

  ${typeInvalid ? RED : YELLOW}type:
    ${typeDescriptions}

  ${invalidScope ? RED : YELLOW}scope:
    ${GRAY}${scopeDescription}${invalidScope ? `${RED}
    ${invalidScopeDescription || defaultInvalidScopeDescription}` : ''}

  ${invalidSubject ? RED : YELLOW}subject:
    ${GRAY}${subjectDescription}${postSubjectDescription}${invalidSubject ? `${RED}
    ${invalidSubjectDescription}` : ''}
  `,
  );
}

/**
 *
 * @param {string} example
 * @param {boolean} typeInvalid
 * @param mergedTypes
 *
 * @example
 * didYouMean('refact: abc', { types: ['refactor'], example: 'docs: xyz' })
 * => 'refactor: abc'
 *
 * didYouMean('abc', { types: ['refactor'], example: 'docs: xyz' })
 * => 'docs: xyz'
 */
function didYouMean(message, { types, example }) {
  const patterns = resolvePatterns(message);

  if (!patterns && !patterns.type) {
    return example;
  }

  const { type } = patterns;

  // Get the closest match
  const suggestedType = suggestType(type, types);

  if (!suggestedType) {
    return example;
  }

  const TYPE_REGEXP = /^\w+(\(\w*\))?:/;

  return message.replace(TYPE_REGEXP, (_, p1) => (p1 && p1 !== '()' ? `${suggestedType}${p1}:` : `${suggestedType}:`));
}

function suggestType(type = '', types) {
  if (!Matcher) {
    return '';
  }

  const matcher = new Matcher(types);
  const match = matcher.get(type);

  if (match) { return match; }

  const suggestedType = types.find((t) => type.includes(t) || t.includes(type));

  return suggestedType || '';
}

/**
 * Decorate the part of pattern.
 *
 * @param {string} text Text to decorate
 * @param {boolean} invalid Whether the part is invalid
 * @param {boolean} optional For example `scope` is optional
 *
 * @returns {string}
 */
function decorate(text, invalid, optional = false) {
  if (invalid) {
    return `${RED}${addPeripherals(underline(text) + RED, optional)}`;
  }

  return `${GREEN}${addPeripherals(text, optional)}`;
}

/**
 * Add peripherals.
 *
 * @example
 * addPeripherals('type')
 * // => "<type>"
 * addPeripherals('scope', true)
 * // => "[scope]"
 *
 * @param {string} text
 * @param {boolean} optional
 *
 * @returns {string}
 */
function addPeripherals(text, optional = false) {
  if (optional) {
    return `[${text}]`;
  }

  return `<${text}>`;
}

/**
 * Put emphasis on text.
 * @param {string} text
 * @returns {string}
 */
function emphasis(text) {
  const ITALIC = '\x1b[3m';
  const UNDERLINED = '\x1b[4m';

  return `${ITALIC}${UNDERLINED}${text}${EOS}`;
}

/**
 * Make text italic.
 * @param {string} text
 * @returns {string}
 */
function italic(text) {
  const ITALIC = '\x1b[3m';

  return `${ITALIC}${text}${EOS}`;
}

/**
 * Make text underlined.
 * @param {string} text
 * @returns {string}
 */
function underline(text) {
  const UNDERLINED = '\x1b[4m';

  return `${UNDERLINED}${text}${EOS}`;
}

/**
 * Make text displayed with error style.
 * @param {string} text
 * @returns {string}
 */
// function red(text) {
//   return `${RED}${text}${EOS}`;
// }

/**
 * isUpperCase
 * @param {string} letter
 * @returns {boolean}
 */
function isUpperCase(letter) {
  return /^[A-Z]$/.test(letter);
}

/**
 * return a string of n spaces
 *
 * @param  {number}
 * @return {string}
 */
function nSpaces(n) {
  const space = ' ';

  return space.repeat(n);
}

/**
 * generate a type description
 *
 * @param {number} options.index type index
 * @param {string} options.type type name
 * @param {string} options.description type description
 * @param {number} options.maxTypeLength max type length
 *
 * @returns {string}
 */
function describe({
  index, type, suggestedType, description, maxTypeLength,
}) {
  const paddingBefore = index === 0 ? '' : nSpaces(4);
  const marginRight = nSpaces(maxTypeLength - type.length + 1);
  const typeColor = suggestedType === type ? GREEN + BOLD : YELLOW;

  return `${paddingBefore}${typeColor}${type}${marginRight}${GRAY}${description}`;
}

/**
 * generate type descriptions
 *
 * @param {Object} mergedTypes
 * @returns {string} type descriptions
 */
function describeTypes(mergedTypes, suggestedType = '') {
  const types = Object.keys(mergedTypes);
  const maxTypeLength = [...types].sort((t1, t2) => t2.length - t1.length)[0].length;

  return types
    .map((type, index) => {
      const description = mergedTypes[type];

      return describe({
        index, type, suggestedType, description, maxTypeLength,
      });
    })
    .join('\n');
}

/**
 * Style text like a label.
 * @param {string} text
 * @returns {string}
 */
function label(text) {
  return `${BOLD}${text}${EOS}`;
}

/**
 * Generate invalid length tips.
 *
 * @param {string} message commit message
 * @param {boolean} invalid
 * @param {number} maxLen
 * @param {number} minLen
 * @param {string} lang
 * @returns {string}
 */
function generateInvalidLengthTips(message, invalid, maxLen, minLen, lang) {
  if (invalid) {
    const max = `${BOLD}${maxLen}${EOS}${RED}`;
    const min = `${BOLD}${minLen}${EOS}${RED}`;
    const { i18n } = getLangData(lang);
    const tips = `${RED}${i18n.length} ${BOLD}${message.length}${EOS}${RED}. ${format(i18n.invalidLengthTip, max, min)}${EOS}`;
    return `\n  ${BOLD}${i18n.invalidLength}${EOS}: ${tips}`;
  }

  return '';
}

/**
 * Output debugging information.
 * @param  {any[]} args
 * @returns {void}
 */
function debug(...args) {
  console.info(`${GREEN}[DEBUG]`, ...args, EOS);
}

/**
 * @returns {string}
 */
function getLanguage(configLang) {
  return configLang
    || process.env.COMMIT_MSG_LINTER_LANG
    || Intl.DateTimeFormat().resolvedOptions().locale;
}

/**
 * Replaces numeric arguments inside curly brackets with their corresponding values.
 *
 * @example
 *  format( 'Good {1}, Mr {2}', 'morning', 'Bob' ) returns 'Good morning, Mr Bob'
 *
 * @param {string} text A text with arguments between curly brackets
 * @param  {any[]} args Values to replace the arguments
 * @returns
 */
function format(text, ...args) {
  return text.replace(/\{(\d+)\}/g, (_, i) => args[i - 1]);
}

function resolvePatterns(message) {
  /* eslint-disable no-useless-escape */
  const PATTERN = /^(?:fixup!\s*)?(\w*)(\(([\w\$\.\*/-]*)\))?\: (.*)$/;
  const matches = PATTERN.exec(message);

  if (matches) {
    const type = matches[1];
    const scope = matches[3];
    const subject = matches[4];

    return {
      type,
      scope,
      subject,
    };
  }

  return null;
}

function getLangs() {
  return {
    'en-US': {
      stereotypes: {
        feat: 'A new feature.',
        fix: 'A bug fix.',
        docs: 'Documentation only changes.',
        style: 'Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc).',
        refactor: 'A code change that neither fixes a bug nor adds a feature.',
        test: 'Adding missing tests or correcting existing ones.',
        chore: 'Changes to the build process or auxiliary tools and libraries such as documentation generation.',
        // added
        perf: 'A code change that improves performance.',
        ci: 'Changes to your CI configuration files and scripts.',
        build: 'Changes that affect the build system or external dependencies (example scopes: gulp, broccoli, npm).',
        temp: 'Temporary commit that won\'t be included in your CHANGELOG.',
      },
      descriptions: {
        example: 'docs: update README to add developer tips',
        scope: [
          'Optional, can be anything specifying the scope of the commit change.',
          'For example $location, $browser, $compile, $rootScope, ngHref, ngClick, ngView, etc.',
          'In App Development, scope can be a page, a module or a component.',
        ],
        invalidScope: [
          '`scope` can be optional, but its parenthesis if exists cannot be empty.',
        ],
        subject: [
          'Brief summary of the change in present tense. Not capitalized. No period at the end.',
        ],
        invalidSubject: [
          '- don\'t capitalize first letter',
          '- no dot "." at the end`',
        ],
      },
      i18n: {
        invalidHeader: 'Invalid Git Commit Message',
        example: 'example',
        commitMessage: 'commit message',
        correctFormat: 'correct format',
        invalidLength: 'Invalid length',
        length: 'Length',
        invalidLengthTip: 'Commit message cannot be longer than {1} characters or shorter than {2} characters',
      },
    },

    'zh-CN': {
      stereotypes: {
        feat: '??????????????????????????????????????????????????????????????????????????????????????????',
        fix: '?????? bug',
        docs: '?????????????????????',
        style: '????????????????????????????????????????????????????????? eslint ???????????????????????????????????????????????? UI ??????',
        refactor: '??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????',
        test: '??????????????????',
        chore: '?????????????????????????????????????????????????????????',
        // added
        perf: '??????????????????',
        ci: '????????????????????????',
        build: '?????????????????????????????????????????????????????????????????????????????? webpack ??? gulp ????????????',
        temp: '???????????????????????? CHANGELOG?????????????????????????????????????????????????????????',
      },
      descriptions: {
        example: 'docs: ?????? README ?????????????????????',
        scope: [
          '??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????',
        ],
        invalidScope: [
          '`scope` ????????????????????????????????????',
        ],
        subject: [
          '?????????????????????????????????????????????????????????????????????????????????????????????????????????????????????',
        ],
        invalidSubject: [
          '?????????????????????',
          '??????????????????',
        ],
      },
      i18n: {
        invalidHeader: 'Git ?????????????????????',
        example: '??????',
        commitMessage: '????????????',
        correctFormat: '????????????',
        invalidLength: '???????????????????????????',
        length: '??????',
        invalidLengthTip: '?????????????????????????????? {1} ????????? {2}',
      },
    },

    'pt-BR': {
      stereotypes: {
        feat: 'Adi????o de funcionalidade.',
        fix: 'Corre????o de defeito.',
        docs: 'Mudan??a em documenta????o.',
        style: 'Mudan??a de formata????o ou estilo, que n??o afeta a execu????o do c??digo (espa??o, tabula????o, etc).',
        refactor: 'Mudan??a na organiza????o do c??digo, que n??o afeta o comportamento existente.',
        test: 'Adi????o ou mudan??a de um teste.',
        chore: 'Adi????o ou mudan??a em script de build, que n??o afeta o c??digo de produ????o.',
        // added
        perf: 'Mudan??a de c??digo para melhoria de desempenho.',
        ci: 'Mudan??a de configura????o de integra????o cont??nua.',
        build: 'Mudan??a em arquivos de build ou em depend??ncias externas.',
        temp: 'Commit tempor??rio, que n??o deve ser inclu??do no CHANGELOG.',
      },
      descriptions: {
        example: 'docs: atualiza o README com link para a nova documenta????o',
        scope: [
          'Opcional, pode ser qualquer coisa que especifique o escopo da mudan??a.',
          'Exemplos: subpacote, workspace, m??dulo, componente, p??gina.',
        ],
        invalidScope: [
          '`scope` ?? opcional, mas o conte??do entre par??nteses n??o pode ficar vazio.',
        ],
        subject: [
          'Breve resumo da mudan??a, escrito no tempo verbal presente. Come??a com letra min??scula e n??o h?? ponto final.',
        ],
        invalidSubject: [
          '- n??o coloque a primeira letra em mai??sculo',
          '- n??o use ponto final',
        ],
      },
      i18n: {
        invalidHeader: 'Mensagem de commit inv??lida',
        example: 'exemplo',
        commitMessage: 'mensagem de commit',
        correctFormat: 'formato correto',
        invalidLength: 'Comprimento inv??lido',
        length: 'Comprimento',
        invalidLengthTip: 'Mensagem de commit n??o pode ser maior que {1} caracteres ou menor que {2}',
      },
    },

    'es-ES': {
      stereotypes: {
        feat: 'Una nueva funcionalidad.',
        fix: 'Corregir un error.',
        docs: 'Cambios ??nicamente en la documentaci??n.',
        style: 'Cambios que no afectan la ejecuci??n del c??digo (espacios en blanco, formato, falta de punto y coma, etc.).',
        refactor: 'Un cambio de c??digo que no afecta el funcionamiento existente (no corrige un error ni a??ade una funci??n.)',
        test: 'A??adir pruebas que faltan o corregir las existentes.',
        chore: 'Cambios en el proceso de construcci??n o en las herramientas y bibliotecas auxiliares, como la generaci??n de documentaci??n, sin afectar el c??digo de producci??n.',
        // added
        perf: 'Un cambio de c??digo que mejora el rendimiento.',
        ci: 'Cambios en sus archivos de configuraci??n y scripts de CI.',
        build: 'Cambios que afectan al sistema de construcci??n o a las dependencias externas (ejemplos de ??mbitos: gulp, broccoli, npm).',
        temp: 'Cambio temporal que no se incluir?? en su CHANGELOG.',
      },
      descriptions: {
        example: 'docs: actualiza el README para a??adir consejos para desarrolladores',
        scope: [
          'Opcional, puede ser cualquier cosa que especifique el alcance del cambio en el commit.',
          'Por ejemplo $location, $browser, $compile, $rootScope, ngHref, ngClick, ngView, etc.',
          'En el desarrollo, el ??mbito puede ser una p??gina, un m??dulo o un componente.',
        ],
        invalidScope: [
          'El `alcance` puede ser opcional, pero su par??ntesis, si existe, no puede estar vac??o.',
        ],
        subject: [
          'Breve resumen del cambio en tiempo presente. Sin may??sculas. Sin punto al final.',
        ],
        invalidSubject: [
          '- no escriba la primera letra en may??scula',
          '- no use "." al final`',
        ],
      },
      i18n: {
        invalidHeader: 'Mensaje del commit inv??lido',
        example: 'ejemplo',
        commitMessage: 'mensaje del commit',
        correctFormat: 'formato correcto',
        invalidLength: 'longitud inv??lida',
        length: 'Longitud',
        invalidLengthTip: 'El mensaje del commit no puede tener m??s de {1} caracteres, o menos de {2}',
      },
    },
  };
}
