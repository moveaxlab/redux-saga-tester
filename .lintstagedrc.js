module.exports = {
  "*.ts": "eslint --fix --max-warnings 0",
  "*.ts": [() => "yarn test:types", "yarn test:unit --passWithNoTests --findRelatedTests"]
};
