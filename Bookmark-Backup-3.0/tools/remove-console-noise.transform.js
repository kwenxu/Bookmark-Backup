const METHODS_TO_REMOVE = new Set(['log', 'info', 'debug', 'trace', 'warn']);

function getMethodName(member) {
  if (!member) return null;
  const { computed, property } = member;

  if (!computed && property && property.type === 'Identifier') {
    return property.name;
  }

  if (
    computed &&
    property &&
    ((property.type === 'Literal' && typeof property.value === 'string') ||
      (property.type === 'StringLiteral' && typeof property.value === 'string'))
  ) {
    return property.value;
  }

  return null;
}

function isConsoleTargetCallExpression(node) {
  if (!node) return false;

  if (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') {
    return false;
  }

  const callee = node.callee;
  if (!callee) return false;

  if (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression') {
    return false;
  }

  if (!callee.object || callee.object.type !== 'Identifier' || callee.object.name !== 'console') {
    return false;
  }

  const methodName = getMethodName(callee);
  return Boolean(methodName && METHODS_TO_REMOVE.has(methodName));
}

module.exports = function transform(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  let changed = false;

  root.find(j.ExpressionStatement).forEach((path) => {
    if (!isConsoleTargetCallExpression(path.node.expression)) {
      return;
    }

    changed = true;

    if (typeof path.name === 'number') {
      j(path).remove();
      return;
    }

    // For single-statement bodies (if/for/while), keep syntax valid.
    j(path).replaceWith(j.emptyStatement());
  });

  if (!changed) {
    return null;
  }

  return root.toSource({
    quote: 'single',
    reuseWhitespace: true,
    lineTerminator: '\n'
  });
};
