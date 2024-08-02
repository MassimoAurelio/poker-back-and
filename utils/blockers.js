let blockers = {
  operationInProgress: false,
  taskRunning: false,
  processing: false,
};

function withBlocker(blockerKey, callback) {
  if (blockers[blockerKey]) {
    return;
  }
  blockers[blockerKey] = true;

  return callback().finally(() => {
    blockers[blockerKey] = false;
  });
}

module.exports = { withBlocker };
