import createSagaMiddleware, { SagaMiddlewareOptions, Task } from 'redux-saga';
import {
  AnyAction,
  applyMiddleware,
  CombinedState,
  createStore,
  Middleware,
  PreloadedState,
  Reducer,
  Store,
} from 'redux';
import { Saga } from '@redux-saga/types';
import { SagaMiddleware } from '@redux-saga/core';

export const RESET_TESTER_ACTION_TYPE = '@@RESET_TESTER';
export const resetAction = { type: RESET_TESTER_ACTION_TYPE };

interface Action {
  callback?: (value?: void | PromiseLike<void> | undefined) => void;
  reject?: (e: Error) => void;
  count: number;
  promise?: PromiseLike<void>;
}

export interface SagaTesterOptions<StateType> {
  initialState?: PreloadedState<StateType>;
  reducers?: Reducer<StateType>;
  middlewares?: Middleware[];
  ignoreReduxActions?: boolean;
  options?: SagaMiddlewareOptions;
}

type SagaReturnType<S extends Saga> = S extends (
  ...args: unknown[]
) => Iterator<unknown, infer R>
  ? R
  : never;

export class SagaTester<S> {
  private calledActions: AnyAction[];

  private actionLookups: { [key: string]: Action };

  private sagaMiddleware: SagaMiddleware;

  private store: Store;

  constructor(
    props: Partial<SagaTesterOptions<S>> = {
      middlewares: [],
      ignoreReduxActions: true,
      options: {},
    }
  ) {
    const {
      reducers,
      middlewares = [],
      ignoreReduxActions,
      options = {},
      initialState,
    } = props;
    this.calledActions = [];
    this.actionLookups = {};
    this.sagaMiddleware = createSagaMiddleware(options);

    const reducerFn: Reducer<S> = reducers
      ? reducers
      : initialState
      ? () => initialState as CombinedState<S>
      : () => ({} as CombinedState<S>);

    const finalInitialState = createStore(reducerFn, initialState).getState();

    const finalReducer: Reducer<S> = (
      state: S | undefined,
      action: AnyAction
    ): CombinedState<S> => {
      // reset state if requested
      if (action.type === RESET_TESTER_ACTION_TYPE) return finalInitialState;

      // supply identity reducer as default
      if (!reducerFn) {
        const stateUpdate = {};

        return Object.assign({}, finalInitialState, stateUpdate);
      }

      // otherwise use the provided reducer
      return reducerFn(state, action);
    };

    // Middleware to store the actions and create promises
    const testerMiddleware = () => (next: (arg0: AnyAction) => AnyAction) => (
      action: AnyAction
    ) => {
      if (ignoreReduxActions && action.type.startsWith('@@redux/')) {
        // Don't monitor redux actions
      } else {
        this.calledActions.push(action);
        const actionObj = this.addAction(action.type);
        actionObj.count++;
        actionObj.callback!();
      }
      return next(action);
    };

    const allMiddlewares = [
      ...middlewares,
      testerMiddleware,
      this.sagaMiddleware,
    ];
    this.store = createStore(finalReducer, applyMiddleware(...allMiddlewares));
  }

  private handleRootSagaException(e: Error) {
    Object.values(this.actionLookups).forEach(action => action.reject!(e));
  }

  private addAction(actionType: string, futureOnly = false) {
    let action = this.actionLookups[actionType];

    if (!action || futureOnly) {
      action = { count: 0 };
      action.promise = new Promise(function(resolve, reject) {
        action.callback = resolve;
        action.reject = reject;
      });
      this.actionLookups[actionType] = action;
    }

    return action;
  }

  private verifyAwaitedActionsCalled() {
    Object.keys(this.actionLookups).forEach(actionType => {
      const action = this.actionLookups[actionType];
      if (action.count === 0 && action.reject) {
        action.reject(
          new Error(actionType + ' was waited for but never called')
        );
      }
    });
  }

  run<S extends Saga>(
    sagas: S,
    ...args: Parameters<S>
  ): Promise<SagaReturnType<S>> {
    const task = this.start(sagas, ...args);
    return task.toPromise();
  }

  /**
   * Starts execution of the provided saga.
   */
  start<S extends Saga>(sagas: S, ...args: Parameters<S>): Task {
    const task = this.sagaMiddleware.run(sagas, ...args);
    const onDone = () => this.verifyAwaitedActionsCalled();
    const onCatch = (e: Error) => this.handleRootSagaException(e);

    const taskPromise = task.toPromise();
    taskPromise.then(onDone);
    taskPromise.catch(onCatch);
    return task;
  }

  reset(clearActionList = false) {
    this.store.dispatch(resetAction);
    if (clearActionList) {
      // Clear existing array in case there are other references to it
      this.calledActions.length = 0;
      // Delete object keys in case there are other references to it
      Object.keys(this.actionLookups).forEach(
        key => delete this.actionLookups[key]
      );
    }
  }

  /**
   * Dispatches an action to the redux store.
   */
  dispatch<T extends AnyAction>(action: T): T {
    return this.store.dispatch(action);
  }

  /**
   * Returns the state of the redux store.
   */
  getState(): S {
    return this.store.getState();
  }

  /**
   * Returns an array of all actions dispatched.
   */
  getCalledActions(): AnyAction[] {
    return this.calledActions.slice(); // shallow copy
  }

  /**
   * Returns the last action dispatched to the store.
   */
  getLatestCalledAction(): AnyAction {
    return this.calledActions[this.calledActions.length - 1];
  }

  /**
   * Returns the last N actions dispatched to the store.
   * @param num The number of actions to return
   */
  getLatestCalledActions(num = 1): AnyAction[] {
    return this.calledActions.slice(-1 * num);
  }

  /**
   * Returns whether the specified was dispatched in the past.
   */
  wasCalled(actionType: string): boolean {
    const action = this.actionLookups[actionType];

    return action ? action.count > 0 : false;
  }

  /**
   * Returns the number of times an action with the given type was dispatched.
   */
  numCalled(actionType: string): number {
    const action = this.actionLookups[actionType];

    return (action && action.count) || 0;
  }

  /**
   * Returns a promise that will resolve if the specified action is dispatched to the store.
   * @param actionType The type of the action to wait for.
   * @param futureOnly Causes waitFor to only resolve if the action is called in the future.
   */
  waitFor(actionType: string, futureOnly = false): PromiseLike<void> {
    return this.addAction(actionType, futureOnly).promise!;
  }
}
