import js from '@eslint/js';
import path from 'node:path';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import importPlugin from 'eslint-plugin-import';
import { configs as tseslint } from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier/recommended';
import perfectionistPlugin from 'eslint-plugin-perfectionist';

const { configs: perfectionist } = perfectionistPlugin;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const eslintConfig = [
    js.configs.recommended,
    ...tseslint.recommended,
    ...tseslint.stylistic,
    importPlugin.flatConfigs.recommended,
    importPlugin.flatConfigs.typescript,
    perfectionist['recommended-natural'],
    prettier,
    {
        files: ['**/*.ts']
    },
    {
        ignores: ['node_modules', 'out/**', 'dist/**', 'build/**', 'coverage/**'],
        languageOptions: {
            parserOptions: {
                ecmaVersion: 2024,
                tsconfigRootDir: import.meta.dirname
            },
            globals: {
                ...globals.node,
                ...globals.es2024,
                NodeJS: true,
                globalThis: false
            }
        },
        settings: {
            typescript: {
                alwaysTryTypes: true
            },
            node: {
                moduleDirectory: ['node_modules', './']
            },
            'import/parsers': {
                '@typescript-eslint/parser': ['.ts']
            },
            'import/resolver': {
                typescript: {
                    alwaysTryTypes: true,
                    project: path.join(__dirname, 'tsconfig.json')
                }
            }
        },
        rules: {
            indent: 'off',
            'no-eval': 'warn',
            'no-with': 'warn',
            'no-undef': 'off',
            'no-octal': 'warn',
            'no-caller': 'warn',
            'use-isnan': 'warn',
            'comma-style': 'off',
            'new-parens': 'warn',
            'no-iterator': 'warn',
            'no-new-func': 'warn',
            'comma-spacing': 'off',
            'no-dupe-args': 'warn',
            'no-dupe-keys': 'warn',
            'no-ex-assign': 'warn',
            'no-label-var': 'warn',
            'no-loop-func': 'warn',
            'no-multi-str': 'warn',
            'no-obj-calls': 'warn',
            'no-redeclare': 'warn',
            'no-sequences': 'warn',
            'valid-typeof': 'warn',
            'getter-return': 'warn',
            'import/first': 'error',
            'no-delete-var': 'warn',
            'no-extra-bind': 'warn',
            'no-new-object': 'warn',
            'no-new-symbol': 'warn',
            'no-script-url': 'warn',
            'require-yield': 'warn',
            'no-unused-vars': 'off',
            'import/no-amd': 'error',
            'no-extra-label': 'warn',
            'no-extra-semi': 'error',
            'no-fallthrough': 'warn',
            'no-func-assign': 'warn',
            'no-lone-blocks': 'warn',
            'no-self-assign': 'warn',
            'no-unreachable': 'warn',
            eqeqeq: ['warn', 'smart'],
            'no-const-assign': 'warn',
            'no-implied-eval': 'warn',
            'no-new-wrappers': 'warn',
            'no-octal-escape': 'warn',
            'no-regex-spaces': 'warn',
            'no-self-compare': 'warn',
            strict: ['warn', 'never'],
            'no-control-regex': 'warn',
            'no-empty-pattern': 'warn',
            'no-extend-native': 'warn',
            'no-global-assign': 'warn',
            'no-sparse-arrays': 'warn',
            'no-throw-literal': 'warn',
            'no-unused-labels': 'warn',
            'no-duplicate-case': 'warn',
            'no-invalid-regexp': 'warn',
            'no-useless-concat': 'warn',
            'no-useless-escape': 'warn',
            'prettier/prettier': 'warn',
            'no-unsafe-negation': 'warn',
            'import/group-exports': 'off',
            'object-curly-spacing': 'off',
            'no-array-constructor': 'warn',
            'no-this-before-super': 'warn',
            'array-callback-return': 'warn',
            'import/no-duplicates': 'error',
            'no-dupe-class-members': 'warn',
            'no-restricted-globals': 'error',
            'no-useless-constructor': 'warn',
            'unicode-bom': ['warn', 'never'],
            'no-useless-computed-key': 'warn',
            'no-empty-character-class': 'warn',
            'dot-location': ['warn', 'property'],
            'no-shadow-restricted-names': 'warn',
            'import/newline-after-import': 'warn',
            'no-template-curly-in-string': 'warn',
            'no-whitespace-before-property': 'warn',
            'rest-spread-spacing': ['warn', 'never'],
            'import/no-webpack-loader-syntax': 'error',
            'no-cond-assign': ['warn', 'except-parens'],
            'import/no-anonymous-default-export': 'warn',
            'no-restricted-syntax': ['warn', 'WithStatement'],
            'default-case': ['warn', { commentPattern: '^no default$' }],
            'no-labels': ['warn', { allowLoop: true, allowSwitch: false }],
            camelcase: [
                'error',
                {
                    allow: ['^.+_']
                }
            ],
            '@typescript-eslint/no-use-before-define': [
                'error',
                {
                    variables: false
                }
            ],
            'arrow-spacing': [
                'warn',
                {
                    after: true,
                    before: true
                }
            ],
            '@typescript-eslint/no-empty-object-type': [
                'error',
                {
                    allowObjectTypes: 'always'
                }
            ],
            'prefer-const': [
                'error',
                {
                    destructuring: 'any',
                    ignoreReadBeforeAssign: false
                }
            ],
            'no-use-before-define': [
                'warn',
                {
                    classes: false,
                    functions: false,
                    variables: false
                }
            ],
            'perfectionist/sort-enums': [
                'error',
                {
                    order: 'asc',
                    type: 'line-length',
                    partitionByComment: true
                }
            ],
            'no-useless-rename': [
                'warn',
                {
                    ignoreExport: false,
                    ignoreImport: false,
                    ignoreDestructuring: false
                }
            ],
            'perfectionist/sort-exports': [
                'error',
                {
                    order: 'asc',
                    type: 'line-length',
                    partitionByComment: true
                }
            ],
            'perfectionist/sort-array-includes': [
                'error',
                {
                    order: 'asc',
                    type: 'line-length',
                    groups: ['literal']
                }
            ],
            'perfectionist/sort-named-imports': [
                'error',
                {
                    order: 'asc',
                    type: 'line-length',
                    partitionByComment: true
                }
            ],
            'perfectionist/sort-named-exports': [
                'error',
                {
                    order: 'asc',
                    type: 'line-length',
                    partitionByComment: true
                }
            ],
            'no-unused-expressions': [
                'error',
                {
                    allowTernary: true,
                    allowShortCircuit: true,
                    allowTaggedTemplates: true
                }
            ],
            'perfectionist/sort-interfaces': [
                'error',
                {
                    order: 'asc',
                    type: 'line-length',
                    groups: [['unknown', 'method'], 'multiline-member', 'multiline-method', 'multiline-property']
                }
            ],
            'perfectionist/sort-object-types': [
                'error',
                {
                    order: 'asc',
                    type: 'line-length',
                    groups: [['unknown', 'method'], 'multiline-member', 'multiline-method', 'multiline-property']
                }
            ],
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    args: 'after-used',
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    ignoreRestSiblings: true,
                    caughtErrorsIgnorePattern: '^_'
                }
            ],
            'perfectionist/sort-objects': [
                'error',
                {
                    order: 'asc',
                    newlinesBetween: 0,
                    type: 'line-length',
                    partitionByComment: true,
                    groups: [['unknown', 'method'], 'multiline-member', 'multiline-method', 'multiline-property']
                }
            ],
            'no-restricted-properties': [
                'error',
                {
                    object: 'require',
                    property: 'ensure',
                    message: 'Please use import() instead.'
                },
                {
                    object: 'System',
                    property: 'import',
                    message: 'Please use import() instead.'
                }
            ],
            'no-mixed-operators': [
                'warn',
                {
                    allowSamePrecedence: false,
                    groups: [
                        ['&', '|', '^', '~', '<<', '>>', '>>>'],
                        ['==', '!=', '===', '!==', '>', '>=', '<', '<='],
                        ['&&', '||'],
                        ['in', 'instanceof']
                    ]
                }
            ],
            'prefer-destructuring': [
                'warn',
                {
                    VariableDeclarator: {
                        array: false,
                        object: true
                    },
                    AssignmentExpression: {
                        array: false,
                        object: false
                    }
                },
                {
                    enforceForRenamedProperties: false
                }
            ],
            'perfectionist/sort-modules': [
                'error',
                {
                    order: 'asc',
                    type: 'line-length',
                    partitionByComment: true,
                    groups: [
                        'declare-enum',
                        'enum',
                        ['declare-interface', 'declare-type'],
                        ['interface', 'type'],
                        'declare-class',
                        'declare-function',
                        'class',
                        'function',
                        'unknown',
                        ['export-enum', 'export-interface', 'export-type'],
                        ['export-function', 'export-default-function'],
                        ['export-class', 'export-default-class']
                    ]
                }
            ],
            'perfectionist/sort-imports': [
                'error',
                {
                    order: 'asc',
                    maxLineLength: 140,
                    newlinesBetween: 1,
                    type: 'line-length',
                    sortSideEffects: true,
                    partitionByComment: true,
                    internalPattern: ['^@/.+', '^./.+', '^../.+'],
                    customGroups: [
                        { groupName: 'json', elementNamePattern: ['.+/*.json', '.+/*.config'] },
                        {
                            groupName: 'utils',
                            elementNamePattern: [
                                '.+/routes',
                                '.+/api/.+',
                                '.+/utils/.+',
                                '.+/store/.+',
                                '.+/hooks/.+',
                                '.+/*.helper',
                                '.+/*.helpers',
                                '.+/shared/.+',
                                '.+/__test__/.+',
                                '.+/__mocks__/.+',
                                '.+/__tests__/.+'
                            ]
                        }
                    ],
                    groups: [
                        ['value-side-effect', 'side-effect-import'],
                        'side-effect',
                        ['builtin', 'external'],
                        ['internal', 'value-internal', 'parent', 'sibling', 'index'],
                        'utils',
                        'unknown',
                        'json',
                        [
                            'type',
                            'type-internal',
                            'named-type-internal',
                            'type-parent',
                            'type-sibling',
                            'type-index',
                            'type-external',
                            'named-type-builtin',
                            'named-type-parent',
                            'named-type-sibling',
                            'named-type-index',
                            'type-builtin',
                            'type-import'
                        ]
                    ]
                }
            ]
        }
    },
    {
        ignores: ['.turbo', '__tmp__', 'node_modules', 'target', 'gen', 'coverage', '.coverage', 'dist', 'build', 'out']
    }
];

export default eslintConfig;
