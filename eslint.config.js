import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
export default [
 {ignores:['dist/**','node_modules/**','data/**','test-results/**']},
 {files:['src/**/*.{js,jsx}','server/**/*.js','tests/**/*.{js,mjs}'],languageOptions:{globals:{...globals.browser,...globals.node},parserOptions:{ecmaFeatures:{jsx:true}}},rules:{...js.configs.recommended.rules,'no-unused-vars':'off','no-empty':['error',{allowEmptyCatch:true}]}},
 ...ts.configs.recommended.map(config=>({...config,files:['src/**/*.{ts,tsx}']})),
 {files:['src/**/*.{ts,tsx}'],languageOptions:{globals:globals.browser},rules:{'@typescript-eslint/no-explicit-any':'error','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_'}]}}
 ,{files:['server/rag.js','server/timetable-agent.js'],rules:{'no-control-regex':'off'}} // These parsers intentionally remove control characters from uploaded text.
];
