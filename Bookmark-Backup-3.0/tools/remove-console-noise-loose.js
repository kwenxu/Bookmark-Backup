#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const acornLoose = require('acorn-loose');
const walk = require('acorn-walk');

const METHODS_TO_REMOVE = new Set(['log', 'info', 'debug', 'trace', 'warn']);

function unwrapChain(node) {
  if (!node) return node;
  if (node.type === 'ChainExpression') return node.expression;
  return node;
}

function getMethodName(memberNode) {
  if (!memberNode || memberNode.type !== 'MemberExpression') return null;

  if (memberNode.computed) {
    const prop = unwrapChain(memberNode.property);
    if (prop && prop.type === 'Literal' && typeof prop.value === 'string') {
      return prop.value;
    }
    return null;
  }

  const prop = unwrapChain(memberNode.property);
  if (prop && prop.type === 'Identifier') {
    return prop.name;
  }
  return null;
}

function isTargetConsoleCallExpression(exprNode) {
  const expr = unwrapChain(exprNode);
  if (!expr || expr.type !== 'CallExpression') return false;

  const callee = unwrapChain(expr.callee);
  if (!callee || callee.type !== 'MemberExpression') return false;

  const objectNode = unwrapChain(callee.object);
  if (!objectNode || objectNode.type !== 'Identifier' || objectNode.name !== 'console') {
    return false;
  }

  const methodName = getMethodName(callee);
  return Boolean(methodName && METHODS_TO_REMOVE.has(methodName));
}

function findChildRef(parent, child) {
  for (const key of Object.keys(parent)) {
    const value = parent[key];
    if (value === child) {
      return { key, isArray: false };
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        if (value[i] === child) {
          return { key, isArray: true, index: i };
        }
      }
    }
  }
  return null;
}

function applyEdits(source, edits) {
  let output = source;
  const sorted = edits
    .slice()
    .sort((a, b) => b.start - a.start || b.end - a.end);

  for (const edit of sorted) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }
  return output;
}

function processFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  const ast = acornLoose.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    allowHashBang: true
  });

  const edits = [];

  walk.fullAncestor(ast, (node, _state, ancestors) => {
    if (node.type !== 'ExpressionStatement') return;
    if (!isTargetConsoleCallExpression(node.expression)) return;

    const parent = ancestors[ancestors.length - 2];
    const ref = parent ? findChildRef(parent, node) : null;

    if (ref && ref.isArray) {
      edits.push({
        start: node.start,
        end: node.end,
        replacement: ''
      });
      return;
    }

    edits.push({
      start: node.start,
      end: node.end,
      replacement: ';'
    });
  });

  if (edits.length === 0) {
    process.stdout.write(`[skip] ${filePath} (no target logs)\n`);
    return;
  }

  const next = applyEdits(source, edits);
  fs.writeFileSync(absolutePath, next, 'utf8');
  process.stdout.write(`[updated] ${filePath} removed ${edits.length} logs\n`);
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node tools/remove-console-noise-loose.js <file ...>');
  process.exit(1);
}

for (const file of files) {
  processFile(file);
}
