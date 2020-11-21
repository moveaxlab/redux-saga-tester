import ts from 'rollup-plugin-ts';
import autoExternal from 'rollup-plugin-auto-external';

export default [
  {
    input: 'src/SagaTester.ts',
    output: {
      file: 'dist/index.js',
      format: 'cjs',
    },
    external: ['redux-saga/effects'],
    plugins: [
      autoExternal(),
      ts({
        tsconfig: './tsconfig.build.json',
      }),
    ],
  },
];
